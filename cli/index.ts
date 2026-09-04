import { VERSION } from "../common/version.js";
import {
  parseAuthConfig,
  type AuthConfig,
} from "../common/auth-config.js";
import {
  getCallbackExpectation,
  startOidcCallbackServer as defaultStartOidcCallbackServer,
  type OidcCallbackServerHandle,
  type OidcCallbackServerOptions,
} from "./oidc-callback-server.js";
import {
  prepareOidcLogin as defaultPrepareOidcLogin,
  type PreparedOidcLogin,
  type PrepareOidcLoginDependencies,
} from "./oidc-login.js";
import {
  launchBrowser as defaultLaunchBrowser,
  redactAuthorizationUrl,
  type BrowserLaunchResult,
} from "./browser-launch.js";

export type Command =
  | { command: "server" }
  | { command: "oidc-login" }
  | { command: "error"; message: string };

export interface CliDependencies {
  startServer: () => Promise<void>;
  oidcLogin: () => Promise<OidcLoginResult | void>;
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
    "  planka-mcp-server oidc-login   Prepare authorization and callback listener",
    "",
    `Unknown command: ${arg}`,
  ].join("\n");

  return { command: "error", message: usage };
}

export interface OidcLoginDependencies {
  prepareOidcLogin: (
    baseUrl: string,
    dependencies?: Partial<PrepareOidcLoginDependencies>,
  ) => Promise<PreparedOidcLogin>;
  getAuthConfig: () => AuthConfig;
  startOidcCallbackServer: (
    options: OidcCallbackServerOptions,
  ) => Promise<OidcCallbackServerHandle>;
  launchBrowser: (authorizationUrl: URL) => Promise<BrowserLaunchResult>;
  writeError: (message: string) => void;
}

export interface OidcLoginResult extends PreparedOidcLogin {
  callbackServer: OidcCallbackServerHandle;
}

function isOidcLoginResult(value: OidcLoginResult | void): value is OidcLoginResult {
  return value !== undefined && value.callbackServer !== undefined;
}

export async function oidcLogin(
  dependencies: Partial<OidcLoginDependencies> = {},
): Promise<OidcLoginResult> {
  const prepare =
    dependencies.prepareOidcLogin ?? defaultPrepareOidcLogin;

  const baseUrl = process.env.PLANKA_BASE_URL;
  if (!baseUrl) {
    throw new Error("PLANKA_BASE_URL is required for OIDC login");
  }

  const prepared = await prepare(baseUrl);
  const config = dependencies.getAuthConfig?.() ?? parseAuthConfig();
  if (config.method !== "oidc") {
    throw new Error("PLANKA_AUTH_METHOD must be oidc for OIDC login");
  }
  const expectation = getCallbackExpectation(prepared, config);
  const startCallbackServer =
    dependencies.startOidcCallbackServer ?? defaultStartOidcCallbackServer;
  const callbackServer = await startCallbackServer({
    host: expectation.host,
    port: expectation.port,
    callbackPath: expectation.path,
    responseMode: expectation.responseMode,
    expectedState: expectation.expectedState,
  });

  const launchBrowser = dependencies.launchBrowser ?? defaultLaunchBrowser;
  const writeError = dependencies.writeError ?? ((message: string) => {
    console.error(message);
  });
  let launchResult: BrowserLaunchResult;
  try {
    launchResult = await launchBrowser(prepared.authorizationUrl);
  } catch {
    launchResult = { launched: false };
  }
  try {
    if (!launchResult.launched) {
      writeError("Could not open the authorization page automatically.");
      writeError(
        `Redacted authorization URL for troubleshooting: ${redactAuthorizationUrl(
          prepared.authorizationUrl,
        )}`,
      );
      writeError("The login listener is still waiting for the browser callback.");
    }
  } catch (error) {
    await callbackServer.close();
    throw error;
  }

  return { ...prepared, callbackServer };
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
      const result = await dependencies.oidcLogin();
      if (isOidcLoginResult(result)) {
        await result.callbackServer.waitForCallback;
      }
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dependencies.writeError(`Error running ${command.command}: ${message}`);
    return 1;
  }
}
