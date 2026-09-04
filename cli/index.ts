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
import {
  exchangeOidcCode as defaultExchangeOidcCode,
  type ExchangeOidcCodeDependencies,
  type ExchangeOidcCodeResult,
} from "../operations/oidc.js";
import { writeStoredToken as defaultWriteStoredToken } from "../common/token-store.js";

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
    "  planka-mcp-server oidc-login   Authenticate with OIDC and store the access token",
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
  exchangeOidcCode: (
    baseUrl: string,
    input: { code: string; nonce: string },
    dependencies?: Partial<ExchangeOidcCodeDependencies>,
  ) => Promise<ExchangeOidcCodeResult>;
  writeStoredToken: (tokenFile: string, token: string) => Promise<void>;
}

export interface OidcLoginResult extends PreparedOidcLogin {
  tokenFile: string;
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

  const callback = await callbackServer.waitForCallback;
  const exchange = dependencies.exchangeOidcCode ?? defaultExchangeOidcCode;
  const exchanged = await exchange(baseUrl, {
    code: callback.code,
    nonce: prepared.nonce,
  });
  const storeToken = dependencies.writeStoredToken ?? defaultWriteStoredToken;
  await storeToken(config.tokenFile, exchanged.accessToken);

  return { ...prepared, tokenFile: config.tokenFile };
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
