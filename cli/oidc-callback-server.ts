import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { OidcAuthConfig } from "../common/auth-config.js";
import type { PreparedOidcLogin } from "./oidc-login.js";

export type OidcResponseMode = "query" | "fragment";

export interface OidcCallbackExpectation {
  host: string;
  port: number;
  path: string;
  responseMode: OidcResponseMode;
  expectedState: string;
}

export interface OidcCallbackResult {
  code: string;
}

export interface OidcCallbackServerOptions {
  host?: string;
  port: number;
  callbackPath: string;
  responseMode: OidcResponseMode;
  expectedState: string;
  timeoutMs?: number;
}

export interface OidcCallbackServerHandle {
  origin: string;
  callbackUrl: URL;
  waitForCallback: Promise<OidcCallbackResult>;
  close(): Promise<void>;
}

const DEFAULT_CALLBACK_TIMEOUT_MS = 180_000;
const MAX_POST_BODY_BYTES = 8 * 1024;
const SUCCESS_HTML = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Login complete</title></head><body><p>Authentication response received. You may close this window.</p></body></html>";
const FAILURE_HTML = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Login failed</title></head><body><p>Authentication response could not be accepted. You may close this window.</p></body></html>";
const RELAY_HTML = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"referrer\" content=\"no-referrer\"><title>Completing login</title></head><body><p>Completing authentication. You may close this window when finished.</p><script>(()=>{const parameters=new URLSearchParams(window.location.hash.slice(1));history.replaceState(null,\"\",window.location.pathname);fetch(window.location.pathname,{method:\"POST\",headers:{\"Content-Type\":\"application/x-www-form-urlencoded\"},body:parameters.toString()}).then(response=>{if(!response.ok)throw new Error();document.body.innerHTML=\"<p>Authentication response received. You may close this window.</p>\";}).catch(()=>{document.body.innerHTML=\"<p>Authentication response could not be accepted. You may close this window.</p>\";});})();</script></body></html>";

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1";
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("OIDC callback timeout must be a positive integer");
  }
}

function compareValues(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer);
}

function singleParameter(
  params: URLSearchParams,
  name: string,
  duplicateMessage: string,
): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1) {
    throw new Error(duplicateMessage);
  }
  return values[0];
}

function validateCallbackParameters(
  params: URLSearchParams,
  expectedState: string | undefined,
): OidcCallbackResult {
  const returnedState = singleParameter(
    params,
    "state",
    "OIDC callback contains duplicate state parameters",
  );

  if (expectedState !== undefined) {
    if (returnedState === undefined || returnedState.length === 0) {
      throw new Error("OIDC callback state is missing");
    }
    if (!compareValues(returnedState, expectedState)) {
      throw new Error("OIDC callback state does not match the login attempt");
    }
  }

  const providerError = singleParameter(
    params,
    "error",
    "OIDC callback contains duplicate error parameters",
  );
  if (providerError !== undefined) {
    const safeError = /^[A-Za-z0-9._-]{1,64}$/.test(providerError)
      ? providerError
      : "unknown_error";
    throw new Error(`OIDC provider denied authorization: ${safeError}`);
  }

  const code = singleParameter(
    params,
    "code",
    "OIDC callback contains duplicate code parameters",
  );
  if (code === undefined || code.length === 0) {
    throw new Error("OIDC callback did not contain an authorization code");
  }

  return { code };
}

function responseHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
  };
}

function sendHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, responseHeaders());
  response.end(body);
}

function sendMethodNotAllowed(response: ServerResponse, allow: string): void {
  response.writeHead(405, { ...responseHeaders(), Allow: allow });
  response.end("Method Not Allowed");
}

function requestUrl(request: IncomingMessage, origin: string): URL | undefined {
  if (!request.url) {
    return undefined;
  }
  try {
    return new URL(request.url, origin);
  } catch {
    return undefined;
  }
}

function readFormBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let rejected = false;

    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      if (rejected) return;
      size += Buffer.byteLength(chunk, "utf8");
      if (size > MAX_POST_BODY_BYTES) {
        rejected = true;
        reject(new Error("OIDC callback body is too large"));
        request.resume();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (!rejected) resolve(body);
    });
    request.on("error", () => {
      if (!rejected) reject(new Error("Failed to read OIDC callback body"));
    });
  });
}

function parseFormBody(body: string): URLSearchParams {
  if (/%(?![0-9A-Fa-f]{2})/.test(body)) {
    throw new Error("OIDC callback body is malformed");
  }
  return new URLSearchParams(body);
}

export function getCallbackExpectation(
  prepared: PreparedOidcLogin,
  config: OidcAuthConfig,
): OidcCallbackExpectation {
  const redirectUriValue = prepared.authorizationUrl.searchParams.get("redirect_uri");
  const responseMode = prepared.authorizationUrl.searchParams.get("response_mode");
  if (!redirectUriValue) {
    throw new Error("Planka OIDC authorization URL does not contain redirect_uri");
  }

  let redirectUri: URL;
  try {
    redirectUri = new URL(redirectUriValue);
  } catch {
    throw new Error("Planka OIDC redirect URI is invalid");
  }

  if (responseMode !== "query" && responseMode !== "fragment") {
    throw new Error(
      `Unsupported Planka OIDC response mode: ${responseMode ?? "missing"}`,
    );
  }

  if (
    redirectUri.protocol !== "http:" ||
    !isLoopbackHost(redirectUri.hostname.replace(/^\[|\]$/g, "")) ||
    redirectUri.hostname.replace(/^\[|\]$/g, "") !== config.callbackHost ||
    (redirectUri.port || "80") !== String(config.callbackPort)
  ) {
    throw new Error(
      "Planka OIDC redirect URI does not target the configured loopback callback",
    );
  }

  // This repository does not pin a Planka version. Planka's published v2
  // configuration defaults to response_mode=fragment, while Planka issue #650
  // records a 1.16 callback as /oidc-callback#code=...&state=.... The nonce is
  // retained for Planka's later exchange; it is not an authorization field.
  const expectedState = prepared.expectedState;
  if (expectedState.length === 0) {
    throw new Error("OIDC callback expected state must not be empty");
  }
  return {
    host: config.callbackHost,
    port: config.callbackPort,
    path: redirectUri.pathname,
    responseMode,
    expectedState,
  };
}

export async function startOidcCallbackServer(
  options: OidcCallbackServerOptions,
): Promise<OidcCallbackServerHandle> {
  const host = options.host ?? "127.0.0.1";
  if (!isLoopbackHost(host)) {
    throw new Error("OIDC callback host must be a loopback address");
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error("OIDC callback port must be an integer between 0 and 65535");
  }
  let callbackPath: URL;
  try {
    callbackPath = new URL(options.callbackPath, "http://127.0.0.1");
  } catch {
    throw new Error("OIDC callback path must be an absolute path");
  }
  if (
    !options.callbackPath.startsWith("/") ||
    options.callbackPath.length === 1 ||
    callbackPath.pathname !== options.callbackPath ||
    callbackPath.search !== "" ||
    callbackPath.hash !== ""
  ) {
    throw new Error("OIDC callback path must be an absolute path");
  }
  if (options.responseMode !== "query" && options.responseMode !== "fragment") {
    throw new Error(`Unsupported Planka OIDC response mode: ${options.responseMode}`);
  }
  if (options.expectedState.length === 0) {
    throw new Error("OIDC callback expected state must not be empty");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS;
  validateTimeout(timeoutMs);

  const server = createServer();
  let settled = false;
  let attemptClaimed = false;
  let listening = false;
  let closePromise: Promise<void> | undefined;
  let resolveResult: (result: OidcCallbackResult) => void = () => {};
  let rejectResult: (error: Error) => void = () => {};
  const waitForCallback = new Promise<OidcCallbackResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  let timer: NodeJS.Timeout | undefined;

  const closeServer = async (): Promise<void> => {
    if (closePromise) {
      await closePromise;
      return;
    }
    if (!listening) return;
    listening = false;
    closePromise = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    server.closeAllConnections();
    server.closeIdleConnections();
    await closePromise;
  };

  const settle = async (result: OidcCallbackResult | Error): Promise<void> => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (result instanceof Error) rejectResult(result);
    else resolveResult(result);
    await closeServer();
  };

  server.on("request", async (request, response) => {
    const requestHost = host.includes(":") ? `[${host}]` : host;
    const url = requestUrl(request, `http://${requestHost}`);
    if (!url || url.pathname !== options.callbackPath) {
      sendHtml(response, 404, "Not Found");
      return;
    }
    if (settled || attemptClaimed) {
      sendHtml(response, 410, FAILURE_HTML);
      return;
    }

    const allowedMethods = options.responseMode === "fragment" ? "GET, POST" : "GET";
    if (
      request.method !== "GET" &&
      !(options.responseMode === "fragment" && request.method === "POST")
    ) {
      sendMethodNotAllowed(response, allowedMethods);
      return;
    }

    if (options.responseMode === "fragment" && request.method === "GET") {
      sendHtml(response, 200, RELAY_HTML);
      return;
    }

    attemptClaimed = true;
    let callbackError: Error | undefined;
    try {
      let params: URLSearchParams;
      if (request.method === "POST") {
        const contentType = request.headers["content-type"];
        if (!contentType?.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
          throw new Error("OIDC callback content type is invalid");
        }
        params = parseFormBody(await readFormBody(request));
      } else {
        params = url.searchParams;
      }
      const result = validateCallbackParameters(params, options.expectedState);
      sendHtml(response, 200, SUCCESS_HTML);
      response.once("finish", () => void settle(result));
      return;
    } catch (error) {
      callbackError = error instanceof Error
        ? error
        : new Error("Invalid OIDC callback");
    }

    sendHtml(response, 400, FAILURE_HTML);
    response.once("finish", () => void settle(callbackError));
  });
  server.on("error", () => {
    if (listening && !settled) {
      void settle(new Error("OIDC callback server failed"));
    }
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(options.port, host);
    });
    listening = true;
  } catch (error) {
    server.close();
    throw new Error("Failed to start the OIDC callback server", { cause: error });
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer();
    throw new Error("Failed to determine the OIDC callback server address");
  }
  const boundAddress = address as AddressInfo;
  const originHost = boundAddress.address.includes(":")
    ? `[${boundAddress.address}]`
    : boundAddress.address;
  const origin = `http://${originHost}:${boundAddress.port}`;
  const callbackUrl = new URL(options.callbackPath, origin);
  timer = setTimeout(
    () => void settle(new Error("Timed out waiting for the OIDC callback")),
    timeoutMs,
  );
  timer.unref();

  return {
    origin,
    callbackUrl,
    waitForCallback,
    close: async () => {
      if (!settled) {
        await settle(new Error("OIDC callback server was closed before login completed"));
      } else {
        await closeServer();
      }
    },
  };
}
