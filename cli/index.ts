import { VERSION } from "../common/version.js";

export type Command =
  | { command: "server" }
  | { command: "oidc-login" }
  | { command: "error"; message: string };

export interface CliDependencies {
  startServer: () => Promise<void>;
  oidcLogin: () => Promise<void>;
  writeError: (message: string) => void;
}

export function resolveCommand(argv: string[]): Command {
  const arg = argv[2];

  if (arg === undefined) {
    return { command: "server" };
  }

  if (arg === "oidc-login") {
    return { command: "oidc-login" };
  }

  const usage = [
    `planka-mcp-server v${VERSION}`,
    "",
    "Usage:",
    "  planka-mcp-server              Start the MCP stdio server (default)",
    "  planka-mcp-server oidc-login   Perform OIDC device-code login",
    "",
    `Unknown command: ${arg}`,
  ].join("\n");

  return { command: "error", message: usage };
}

export async function oidcLogin(
  writeError: (message: string) => void = console.error,
): Promise<void> {
  writeError("OIDC login is not yet implemented. This is a placeholder command.");
}

export async function runCli(
  argv: string[],
  dependencies: CliDependencies,
): Promise<number> {
  const command = resolveCommand(argv);

  if (command.command === "error") {
    dependencies.writeError(command.message);
    return 1;
  }

  try {
    if (command.command === "server") {
      await dependencies.startServer();
    } else {
      await dependencies.oidcLogin();
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dependencies.writeError(`Error running ${command.command}: ${message}`);
    return 1;
  }
}
