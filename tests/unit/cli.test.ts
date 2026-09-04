import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { BrowserLaunchResult } from "../../cli/browser-launch.js";
import {
  type OidcLoginResult,
  oidcLogin,
  resolveCommand,
  runCli,
} from "../../cli/index.js";
import type { OidcCallbackServerHandle } from "../../cli/oidc-callback-server.js";
import type { PreparedOidcLogin } from "../../cli/oidc-login.js";
import { getDefaultTokenPath } from "../../common/auth-config.js";
import type { ExchangeOidcCodeResult } from "../../operations/oidc.js";

function callbackDependencies() {
  const close = jest.fn<() => Promise<void>>().mockResolvedValue();
  const callbackServer: OidcCallbackServerHandle = {
    origin: "http://127.0.0.1:18931",
    callbackUrl: new URL("http://127.0.0.1:18931/callback"),
    waitForCallback: Promise.resolve({ code: "callback-code" }),
    close,
  };
  return {
    getAuthConfig: () => ({
      method: "oidc" as const,
      tokenFile: "/tmp/token",
      callbackHost: "127.0.0.1",
      callbackPort: 18931,
    }),
    startOidcCallbackServer: jest
      .fn<() => Promise<OidcCallbackServerHandle>>()
      .mockResolvedValue(callbackServer),
    launchBrowser: jest
      .fn<(authorizationUrl: URL) => Promise<{ launched: boolean }>>()
      .mockResolvedValue({ launched: true }),
    exchangeOidcCode: jest
      .fn<
        (
          baseUrl: string,
          input: { code: string; nonce: string },
        ) => Promise<ExchangeOidcCodeResult>
      >()
      .mockResolvedValue({ accessToken: "test-access-token" }),
    writeStoredToken: jest
      .fn<(tokenFile: string, token: string) => Promise<void>>()
      .mockResolvedValue(),
    callbackServer,
  };
}

describe("resolveCommand", () => {
  it("selects server when no arguments are provided", () => {
    expect(resolveCommand(["node", "dist/index.js"])).toEqual({
      command: "server",
    });
  });

  it("selects oidc-login for the oidc-login argument", () => {
    expect(resolveCommand(["node", "dist/index.js", "oidc-login"])).toEqual({
      command: "oidc-login",
    });
  });

  it("returns an error for an unknown command", () => {
    const result = resolveCommand(["node", "dist/index.js", "bad"]);
    expect(result).toEqual({
      command: "error",
      message: expect.stringContaining("Unknown command: bad"),
    });
  });

  it("error message includes usage information", () => {
    const result = resolveCommand(["node", "dist/index.js", "foo"]);
    expect(result.command).toBe("error");
    if (result.command === "error") {
      expect(result.message).toContain("Usage:");
      expect(result.message).toContain("oidc-login");
    }
  });
});

describe("oidcLogin", () => {
  const originalBaseUrl = process.env.PLANKA_BASE_URL;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalBaseUrl === undefined) {
      delete process.env.PLANKA_BASE_URL;
    } else {
      process.env.PLANKA_BASE_URL = originalBaseUrl;
    }
  });

  it("returns prepared login data without logging the authorization URL", async () => {
    process.env.PLANKA_BASE_URL = "https://planka.example";
    const stderr = jest.spyOn(console, "error").mockImplementation(() => {});
    const prepareOidcLogin =
      jest.fn<
        (
          baseUrl: string,
          deps?: unknown,
        ) => Promise<{
          authorizationUrl: URL;
          nonce: string;
          expectedState: string;
        }>
      >();
    prepareOidcLogin.mockResolvedValue({
      authorizationUrl: new URL(
        "https://idp.example/auth?client_id=x&nonce=n1&redirect_uri=http%3A%2F%2F127.0.0.1%3A18931%2Fcallback&response_mode=query",
      ),
      nonce: "n1",
      expectedState: "s1",
    });

    const callback = callbackDependencies();
    const result = await oidcLogin({ prepareOidcLogin, ...callback });

    expect(prepareOidcLogin).toHaveBeenCalledWith("https://planka.example");
    expect(result.authorizationUrl.hostname).toBe("idp.example");
    expect(result.nonce).toBe("n1");
    expect(result.expectedState).toBe("s1");
    expect(callback.startOidcCallbackServer).toHaveBeenCalled();
    expect(callback.exchangeOidcCode).toHaveBeenCalledWith(
      "https://planka.example",
      { code: "callback-code", nonce: "n1" },
    );
    expect(callback.exchangeOidcCode).toHaveBeenCalledTimes(1);
    expect(callback.writeStoredToken).toHaveBeenCalledWith(
      "/tmp/token",
      "test-access-token",
    );
    expect(callback.writeStoredToken).toHaveBeenCalledTimes(1);
    expect(result.tokenFile).toBe("/tmp/token");
    expect(stderr).not.toHaveBeenCalled();
  });

  it("uses the default configured token path when no override is set", async () => {
    process.env.PLANKA_BASE_URL = "https://planka.example";
    const callback = callbackDependencies();
    callback.getAuthConfig = () => ({
      method: "oidc" as const,
      tokenFile: getDefaultTokenPath(),
      callbackHost: "127.0.0.1",
      callbackPort: 18931,
    });
    const prepareOidcLogin = jest
      .fn<() => Promise<PreparedOidcLogin>>()
      .mockResolvedValue({
        authorizationUrl: new URL(
          "https://idp.example/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A18931%2Fcallback&response_mode=query",
        ),
        nonce: "nonce",
        expectedState: "state",
      });

    await oidcLogin({ prepareOidcLogin, ...callback });

    expect(callback.writeStoredToken).toHaveBeenCalledWith(
      getDefaultTokenPath(),
      "test-access-token",
    );
  });

  it("returns 0 on success through runCli", async () => {
    process.env.PLANKA_BASE_URL = "https://planka.example";
    const writeError = jest.fn<(message: string) => void>();
    const prepareOidcLogin =
      jest.fn<
        () => Promise<{
          authorizationUrl: URL;
          nonce: string;
          expectedState: string;
        }>
      >();
    prepareOidcLogin.mockResolvedValue({
      authorizationUrl: new URL(
        "https://idp.example/auth?nonce=n&redirect_uri=http%3A%2F%2F127.0.0.1%3A18931%2Fcallback&response_mode=query",
      ),
      nonce: "n",
      expectedState: "s",
    });

    const result = await runCli(["node", "dist/index.js", "oidc-login"], {
      startServer: jest.fn<() => Promise<void>>(),
      oidcLogin: () =>
        oidcLogin({
          prepareOidcLogin,
          ...callbackDependencies(),
        }),
      writeError,
    });

    expect(result).toBe(0);
    expect(writeError.mock.calls.flat().join(" ")).not.toContain(
      "test-access-token",
    );
  });

  it("returns non-zero when the callback fails", async () => {
    const writeError = jest.fn<(message: string) => void>();
    const callbackFailure = new Error("callback failed");

    const result = await runCli(["node", "dist/index.js", "oidc-login"], {
      startServer: jest.fn<() => Promise<void>>(),
      oidcLogin: jest
        .fn<() => Promise<OidcLoginResult>>()
        .mockRejectedValue(callbackFailure),
      writeError,
    });

    expect(result).toBe(1);
    expect(writeError).toHaveBeenCalledWith(
      "Error running oidc-login: callback failed",
    );
  });

  it("does not exchange when callback validation fails", async () => {
    process.env.PLANKA_BASE_URL = "https://planka.example";
    const callback = callbackDependencies();
    const callbackFailure = Promise.reject(new Error("callback denied"));
    void callbackFailure.catch(() => {});
    callback.callbackServer.waitForCallback = callbackFailure;
    const exchangeOidcCode = jest
      .fn<
        (
          baseUrl: string,
          input: { code: string; nonce: string },
        ) => Promise<ExchangeOidcCodeResult>
      >()
      .mockResolvedValue({ accessToken: "SECRET_ACCESS_TOKEN" });
    const prepareOidcLogin = jest
      .fn<() => Promise<PreparedOidcLogin>>()
      .mockResolvedValue({
        authorizationUrl: new URL(
          "https://idp.example/auth?nonce=SECRET_NONCE&state=state&redirect_uri=http%3A%2F%2F127.0.0.1%3A18931%2Fcallback&response_mode=query",
        ),
        nonce: "SECRET_NONCE",
        expectedState: "state",
      });

    await expect(
      oidcLogin({ ...callback, prepareOidcLogin, exchangeOidcCode }),
    ).rejects.toThrow("callback denied");
    expect(exchangeOidcCode).not.toHaveBeenCalled();
    expect(callback.writeStoredToken).not.toHaveBeenCalled();
  });

  it("reports exchange failure without exposing exchange secrets", async () => {
    process.env.PLANKA_BASE_URL = "https://planka.example";
    const writeError = jest.fn<(message: string) => void>();
    const callback = callbackDependencies();
    const exchangeOidcCode = jest
      .fn<
        (
          baseUrl: string,
          input: { code: string; nonce: string },
        ) => Promise<ExchangeOidcCodeResult>
      >()
      .mockRejectedValue(
        new Error("Planka rejected the OIDC authorization code (HTTP 401)."),
      );
    const prepareOidcLogin = jest
      .fn<() => Promise<PreparedOidcLogin>>()
      .mockResolvedValue({
        authorizationUrl: new URL(
          "https://idp.example/auth?nonce=SECRET_NONCE&state=SECRET_STATE&redirect_uri=http%3A%2F%2F127.0.0.1%3A18931%2Fcallback&response_mode=query",
        ),
        nonce: "SECRET_NONCE",
        expectedState: "SECRET_STATE",
      });

    const result = await runCli(["node", "dist/index.js", "oidc-login"], {
      startServer: jest.fn<() => Promise<void>>(),
      oidcLogin: () =>
        oidcLogin({
          ...callback,
          prepareOidcLogin,
          exchangeOidcCode,
          writeError,
        }),
      writeError,
    });

    expect(result).toBe(1);
    expect(exchangeOidcCode).toHaveBeenCalledTimes(1);
    const messages = writeError.mock.calls.flat().join(" ");
    expect(messages).not.toContain("SECRET_NONCE");
    expect(messages).not.toContain("SECRET_STATE");
    expect(messages).not.toContain("SECRET_ACCESS_TOKEN");
    expect(messages).not.toContain("SECRET_PENDING_TOKEN");
    expect(callback.writeStoredToken).not.toHaveBeenCalled();
  });

  it("returns non-zero when secure token storage fails", async () => {
    process.env.PLANKA_BASE_URL = "https://planka.example";
    const writeError = jest.fn<(message: string) => void>();
    const callback = callbackDependencies();
    const writeStoredToken = jest
      .fn<(tokenFile: string, token: string) => Promise<void>>()
      .mockRejectedValue(new Error("storage unavailable"));
    const prepareOidcLogin = jest
      .fn<() => Promise<PreparedOidcLogin>>()
      .mockResolvedValue({
        authorizationUrl: new URL(
          "https://idp.example/auth?nonce=SECRET_NONCE&state=SECRET_STATE&redirect_uri=http%3A%2F%2F127.0.0.1%3A18931%2Fcallback&response_mode=query",
        ),
        nonce: "SECRET_NONCE",
        expectedState: "SECRET_STATE",
      });

    const result = await runCli(["node", "dist/index.js", "oidc-login"], {
      startServer: jest.fn<() => Promise<void>>(),
      oidcLogin: () =>
        oidcLogin({
          ...callback,
          prepareOidcLogin,
          writeStoredToken,
          writeError,
        }),
      writeError,
    });

    expect(result).toBe(1);
    expect(writeStoredToken).toHaveBeenCalledTimes(1);
    expect(writeError).toHaveBeenCalledWith(
      "Error running oidc-login: storage unavailable",
    );
    expect(writeError.mock.calls.flat().join(" ")).not.toContain(
      "test-access-token",
    );
    expect(writeError.mock.calls.flat().join(" ")).not.toContain(
      "SECRET_NONCE",
    );
  });

  it("returns non-zero on preparation failure", async () => {
    process.env.PLANKA_BASE_URL = "https://planka.example";
    const writeError = jest.fn<(message: string) => void>();
    const prepareOidcLogin =
      jest.fn<
        () => Promise<{
          authorizationUrl: URL;
          nonce: string;
          expectedState: string;
        }>
      >();
    prepareOidcLogin.mockRejectedValue(
      new Error("Planka bootstrap request failed with HTTP 503"),
    );

    const result = await runCli(["node", "dist/index.js", "oidc-login"], {
      startServer: jest.fn<() => Promise<void>>(),
      oidcLogin: () => oidcLogin({ prepareOidcLogin }),
      writeError,
    });

    expect(result).toBe(1);
    expect(writeError).toHaveBeenCalledWith(
      expect.stringContaining("HTTP 503"),
    );
  });

  it("rejects clearly when PLANKA_BASE_URL is missing", async () => {
    delete process.env.PLANKA_BASE_URL;

    await expect(oidcLogin()).rejects.toThrow("PLANKA_BASE_URL is required");
  });

  it("never starts the MCP server", async () => {
    process.env.PLANKA_BASE_URL = "https://planka.example";
    const writeError = jest.fn<(message: string) => void>();
    const startServer = jest.fn<() => Promise<void>>();
    const prepareOidcLogin =
      jest.fn<
        () => Promise<{
          authorizationUrl: URL;
          nonce: string;
          expectedState: string;
        }>
      >();
    prepareOidcLogin.mockResolvedValue({
      authorizationUrl: new URL("https://idp.example/auth?nonce=n"),
      nonce: "n",
      expectedState: "s",
    });

    await runCli(["node", "dist/index.js", "oidc-login"], {
      startServer,
      oidcLogin: () =>
        oidcLogin({
          prepareOidcLogin,
          ...callbackDependencies(),
        }),
      writeError,
    });

    expect(startServer).not.toHaveBeenCalled();
  });

  it("continues waiting when browser launch fails", async () => {
    process.env.PLANKA_BASE_URL = "https://planka.example";
    const writeError = jest.fn<(message: string) => void>();
    let resolveCallback: (value: { code: string }) => void = () => {};
    const callback = callbackDependencies();
    callback.callbackServer.waitForCallback = new Promise((resolve) => {
      resolveCallback = resolve;
    });
    const prepareOidcLogin = jest
      .fn<() => Promise<PreparedOidcLogin>>()
      .mockResolvedValue({
        authorizationUrl: new URL(
          "https://idp.example/auth?client_id=public&nonce=secret-nonce&state=secret-state&redirect_uri=http%3A%2F%2F127.0.0.1%3A18931%2Fcallback&response_mode=query",
        ),
        nonce: "secret-nonce",
        expectedState: "secret-state",
      });
    const launchBrowser = jest
      .fn<(authorizationUrl: URL) => Promise<BrowserLaunchResult>>()
      .mockResolvedValue({ launched: false });

    let settled = false;
    const resultPromise = runCli(["node", "dist/index.js", "oidc-login"], {
      startServer: jest.fn<() => Promise<void>>(),
      oidcLogin: () =>
        oidcLogin({
          prepareOidcLogin,
          ...callback,
          launchBrowser,
          writeError,
        }),
      writeError,
    }).then((result) => {
      settled = true;
      return result;
    });

    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }
    expect(launchBrowser).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    expect(callback.callbackServer.close).not.toHaveBeenCalled();
    expect(writeError).toHaveBeenCalledWith(
      "Could not open the authorization page automatically.",
    );
    expect(writeError.mock.calls.flat().join(" ")).not.toContain("secret-");

    resolveCallback({ code: "callback-code" });
    await expect(resultPromise).resolves.toBe(0);
  });

  it("keeps callback failure authoritative after browser launch failure", async () => {
    process.env.PLANKA_BASE_URL = "https://planka.example";
    const writeError = jest.fn<(message: string) => void>();
    const callback = callbackDependencies();
    callback.callbackServer.waitForCallback = Promise.reject(
      new Error("callback timeout"),
    );
    void callback.callbackServer.waitForCallback.catch(() => {});
    const prepareOidcLogin = jest
      .fn<() => Promise<PreparedOidcLogin>>()
      .mockResolvedValue({
        authorizationUrl: new URL(
          "https://idp.example/auth?nonce=secret-nonce&state=secret-state&redirect_uri=http%3A%2F%2F127.0.0.1%3A18931%2Fcallback&response_mode=query",
        ),
        nonce: "secret-nonce",
        expectedState: "secret-state",
      });
    const launchBrowser = jest
      .fn<(authorizationUrl: URL) => Promise<BrowserLaunchResult>>()
      .mockRejectedValue(new Error("launcher failed with state=secret-state"));

    const result = await runCli(["node", "dist/index.js", "oidc-login"], {
      startServer: jest.fn<() => Promise<void>>(),
      oidcLogin: () =>
        oidcLogin({
          prepareOidcLogin,
          ...callback,
          launchBrowser,
          writeError,
        }),
      writeError,
    });

    expect(result).toBe(1);
    expect(writeError.mock.calls.flat().join(" ")).toContain(
      "callback timeout",
    );
    expect(writeError.mock.calls.flat().join(" ")).not.toContain("secret-");
  });
});

describe("runCli", () => {
  function createDependencies() {
    return {
      startServer: jest.fn<() => Promise<void>>().mockResolvedValue(),
      oidcLogin: jest.fn<() => Promise<void>>().mockResolvedValue(),
      writeError: jest.fn<(message: string) => void>(),
    };
  }

  it("starts the MCP server when no command is provided", async () => {
    const dependencies = createDependencies();

    await expect(runCli(["node", "dist/index.js"], dependencies)).resolves.toBe(
      0,
    );
    expect(dependencies.startServer).toHaveBeenCalledTimes(1);
    expect(dependencies.oidcLogin).not.toHaveBeenCalled();
    expect(dependencies.writeError).not.toHaveBeenCalled();
  });

  it("runs OIDC login without starting the MCP server", async () => {
    const dependencies = createDependencies();

    await expect(
      runCli(["node", "dist/index.js", "oidc-login"], dependencies),
    ).resolves.toBe(0);
    expect(dependencies.oidcLogin).toHaveBeenCalledTimes(1);
    expect(dependencies.startServer).not.toHaveBeenCalled();
    expect(dependencies.writeError).not.toHaveBeenCalled();
  });

  it("reports an unknown command without running either action", async () => {
    const dependencies = createDependencies();

    await expect(
      runCli(["node", "dist/index.js", "unknown"], dependencies),
    ).resolves.toBe(1);
    expect(dependencies.startServer).not.toHaveBeenCalled();
    expect(dependencies.oidcLogin).not.toHaveBeenCalled();
    expect(dependencies.writeError).toHaveBeenCalledWith(
      expect.stringContaining("Unknown command: unknown"),
    );
  });

  it("reports command failures without terminating the process", async () => {
    const dependencies = createDependencies();
    dependencies.oidcLogin.mockRejectedValue(new Error("login failed"));

    await expect(
      runCli(["node", "dist/index.js", "oidc-login"], dependencies),
    ).resolves.toBe(1);
    expect(dependencies.startServer).not.toHaveBeenCalled();
    expect(dependencies.writeError).toHaveBeenCalledWith(
      "Error running oidc-login: login failed",
    );
  });
});
