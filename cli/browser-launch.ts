import { spawn, type ChildProcess } from "node:child_process";

export interface BrowserLaunchDependencies {
  platform: NodeJS.Platform;
  spawn: typeof spawn;
}

export interface BrowserLaunchResult {
  launched: boolean;
  error?: Error;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function validateAuthorizationUrl(url: URL): void {
  if (url.username || url.password) {
    throw new Error("Authorization URL must not contain credentials");
  }
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return;
  throw new Error("Authorization URL must use HTTPS");
}

function platformCommand(platform: NodeJS.Platform):
  | { executable: string; args: string[] }
  | undefined {
  switch (platform) {
    case "linux":
      return { executable: "xdg-open", args: [] };
    case "darwin":
      return { executable: "open", args: [] };
    case "win32":
      return { executable: "explorer.exe", args: [] };
    default:
      return undefined;
  }
}

function safeLaunchError(): Error {
  return new Error("Failed to open the authorization page automatically");
}

const SPAWN_CONFIRMATION_MS = 250;

function waitForSpawn(child: ChildProcess): Promise<BrowserLaunchResult> {
  return new Promise((resolve) => {
    let settled = false;
    let confirmationTimer: NodeJS.Timeout | undefined;
    const finish = (result: BrowserLaunchResult): void => {
      if (settled) return;
      settled = true;
      if (confirmationTimer) clearTimeout(confirmationTimer);
      child.off("spawn", onSpawn);
      child.off("close", onClose);
      resolve(result);
    };
    const onSpawn = (): void => {
      child.unref();
      confirmationTimer = setTimeout(
        () => finish({ launched: true }),
        SPAWN_CONFIRMATION_MS,
      );
      confirmationTimer.unref();
    };
    const onClose = (code: number | null): void => {
      if (code === 0) finish({ launched: true });
      else finish({ launched: false, error: safeLaunchError() });
    };
    // Keep this listener attached after a successful confirmation. A child
    // process can report an error after spawn, and EventEmitter treats an
    // unhandled "error" event as a process-level failure.
    const onError = (): void => {
      if (!settled) finish({ launched: false, error: safeLaunchError() });
    };

    child.once("spawn", onSpawn);
    child.once("close", onClose);
    child.on("error", onError);
  });
}

export async function launchBrowser(
  authorizationUrl: URL,
  dependencies: Partial<BrowserLaunchDependencies> = {},
): Promise<BrowserLaunchResult> {
  try {
    validateAuthorizationUrl(authorizationUrl);
  } catch (error) {
    return {
      launched: false,
      error: error instanceof Error ? error : safeLaunchError(),
    };
  }

  const command = platformCommand(dependencies.platform ?? process.platform);
  if (!command) return { launched: false, error: safeLaunchError() };

  try {
    const spawnFn = dependencies.spawn ?? spawn;
    const child = spawnFn(
      command.executable,
      [...command.args, authorizationUrl.toString()],
      { detached: true, stdio: "ignore", shell: false },
    );
    return await waitForSpawn(child);
  } catch {
    return { launched: false, error: safeLaunchError() };
  }
}

const sensitiveParameterPattern =
  /token|secret|code|nonce|state|assertion/i;

export function redactAuthorizationUrl(url: URL): string {
  const redacted = new URL(url.toString());
  redacted.hash = "";
  for (const name of new Set(redacted.searchParams.keys())) {
    if (sensitiveParameterPattern.test(name)) {
      redacted.searchParams.set(name, "<redacted>");
      continue;
    }

    if (name.toLowerCase() === "redirect_uri") {
      const value = redacted.searchParams.get(name);
      if (value === null) continue;
      try {
        redacted.searchParams.set(
          name,
          redactAuthorizationUrl(new URL(value)),
        );
      } catch {
        redacted.searchParams.set(name, "<redacted>");
      }
    }
  }
  return redacted.toString();
}
