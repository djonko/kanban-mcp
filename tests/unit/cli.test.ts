import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { oidcLogin, resolveCommand, runCli } from "../../cli/index.js";

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
        ) => Promise<{ authorizationUrl: URL; nonce: string }>
      >();
    prepareOidcLogin.mockResolvedValue({
      authorizationUrl: new URL(
        "https://idp.example/auth?client_id=x&nonce=n1",
      ),
      nonce: "n1",
    });

    const result = await oidcLogin({ prepareOidcLogin });

    expect(prepareOidcLogin).toHaveBeenCalledWith("https://planka.example");
    expect(result.authorizationUrl.hostname).toBe("idp.example");
    expect(result.nonce).toBe("n1");
    expect(stderr).not.toHaveBeenCalled();
  });

  it("returns 0 on success through runCli", async () => {
    process.env.PLANKA_BASE_URL = "https://planka.example";
    const writeError = jest.fn<(message: string) => void>();
    const prepareOidcLogin =
      jest.fn<() => Promise<{ authorizationUrl: URL; nonce: string }>>();
    prepareOidcLogin.mockResolvedValue({
      authorizationUrl: new URL("https://idp.example/auth?nonce=n"),
      nonce: "n",
    });

    const result = await runCli(["node", "dist/index.js", "oidc-login"], {
      startServer: jest.fn<() => Promise<void>>(),
      oidcLogin: () => oidcLogin({ prepareOidcLogin }),
      writeError,
    });

    expect(result).toBe(0);
  });

  it("returns non-zero on preparation failure", async () => {
    process.env.PLANKA_BASE_URL = "https://planka.example";
    const writeError = jest.fn<(message: string) => void>();
    const prepareOidcLogin =
      jest.fn<() => Promise<{ authorizationUrl: URL; nonce: string }>>();
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
      jest.fn<() => Promise<{ authorizationUrl: URL; nonce: string }>>();
    prepareOidcLogin.mockResolvedValue({
      authorizationUrl: new URL("https://idp.example/auth?nonce=n"),
      nonce: "n",
    });

    await runCli(["node", "dist/index.js", "oidc-login"], {
      startServer,
      oidcLogin: () => oidcLogin({ prepareOidcLogin }),
      writeError,
    });

    expect(startServer).not.toHaveBeenCalled();
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
