import { homedir } from "node:os";
import { join } from "node:path";

export type AuthMethod = "password" | "oidc";

export interface PasswordAuthConfig {
  method: "password";
  email: string;
  password: string;
}

export interface OidcAuthConfig {
  method: "oidc";
  tokenFile: string;
  callbackHost: string;
  callbackPort: number;
}

export type AuthConfig = PasswordAuthConfig | OidcAuthConfig;

export function getDefaultTokenPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME;
  const base = configHome && configHome.length > 0
    ? configHome
    : join(homedir(), ".config");
  return join(base, "kanban-mcp", "planka-token");
}

export function parsePort(value: string | undefined): number {
  if (value === undefined || value === "") {
    throw new Error("Port value is required");
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid port: '${value}'. Must be an integer between 1 and 65535.`,
    );
  }
  return port;
}

export function parseAuthConfig(): AuthConfig {
  const method = process.env.PLANKA_AUTH_METHOD || "password";

  if (method !== "password" && method !== "oidc") {
    throw new Error(
      `Unknown PLANKA_AUTH_METHOD: '${method}'. Must be 'password' or 'oidc'.`,
    );
  }

  if (method === "password") {
    const email = process.env.PLANKA_AGENT_EMAIL;
    const password = process.env.PLANKA_AGENT_PASSWORD;
    if (!email) {
      throw new Error(
        "PLANKA_AGENT_EMAIL environment variable is required for password authentication",
      );
    }
    if (!password) {
      throw new Error(
        "PLANKA_AGENT_PASSWORD environment variable is required for password authentication",
      );
    }
    return { method: "password", email, password };
  }

  const tokenFile = process.env.PLANKA_TOKEN_FILE || getDefaultTokenPath();
  const callbackHost = process.env.PLANKA_OIDC_CALLBACK_HOST || "127.0.0.1";
  const callbackPort = parsePort(process.env.PLANKA_OIDC_CALLBACK_PORT || "18931");

  return { method: "oidc", tokenFile, callbackHost, callbackPort };
}
