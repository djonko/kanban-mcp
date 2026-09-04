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
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("prints a placeholder message to stderr", async () => {
    const writeError = jest.fn<(message: string) => void>();

    await oidcLogin(writeError);

    expect(writeError).toHaveBeenCalledWith(
      expect.stringContaining("not yet implemented"),
    );
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
