import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
  getDefaultTokenPath,
  parseAuthConfig,
  parsePort,
} from "../../common/auth-config.js";

describe("getDefaultTokenPath", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses XDG_CONFIG_HOME when set", () => {
    process.env.XDG_CONFIG_HOME = "/custom/config";
    expect(getDefaultTokenPath()).toBe(
      "/custom/config/kanban-mcp/planka-token",
    );
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is unset", () => {
    delete process.env.XDG_CONFIG_HOME;
    const result = getDefaultTokenPath();
    expect(result).toMatch(/\.config\/kanban-mcp\/planka-token$/);
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is empty", () => {
    process.env.XDG_CONFIG_HOME = "";
    const result = getDefaultTokenPath();
    expect(result).toMatch(/\.config\/kanban-mcp\/planka-token$/);
  });
});

describe("parsePort", () => {
  it("returns the port for a valid value", () => {
    expect(parsePort("8080")).toBe(8080);
    expect(parsePort("1")).toBe(1);
    expect(parsePort("65535")).toBe(65535);
  });

  it("throws for a non-numeric value", () => {
    expect(() => parsePort("abc")).toThrow("Invalid port: 'abc'");
  });

  it("throws for a decimal value", () => {
    expect(() => parsePort("1.5")).toThrow("Invalid port: '1.5'");
  });

  it("throws for zero", () => {
    expect(() => parsePort("0")).toThrow("Invalid port: '0'");
  });

  it("throws for a value above 65535", () => {
    expect(() => parsePort("65536")).toThrow("Invalid port: '65536'");
  });

  it("throws for undefined", () => {
    expect(() => parsePort(undefined)).toThrow("Port value is required");
  });

  it("throws for empty string", () => {
    expect(() => parsePort("")).toThrow("Port value is required");
  });
});

describe("parseAuthConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PLANKA_AUTH_METHOD;
    delete process.env.PLANKA_AGENT_EMAIL;
    delete process.env.PLANKA_AGENT_PASSWORD;
    delete process.env.PLANKA_TOKEN_FILE;
    delete process.env.PLANKA_OIDC_CALLBACK_HOST;
    delete process.env.PLANKA_OIDC_CALLBACK_PORT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("password method", () => {
    it("returns password config with valid env vars", () => {
      process.env.PLANKA_AGENT_EMAIL = "user@test.com";
      process.env.PLANKA_AGENT_PASSWORD = "secret";
      const config = parseAuthConfig();
      expect(config).toEqual({
        method: "password",
        email: "user@test.com",
        password: "secret",
      });
    });

    it("defaults to password when PLANKA_AUTH_METHOD is absent", () => {
      process.env.PLANKA_AGENT_EMAIL = "user@test.com";
      process.env.PLANKA_AGENT_PASSWORD = "secret";
      delete process.env.PLANKA_AUTH_METHOD;
      const config = parseAuthConfig();
      expect(config.method).toBe("password");
    });

    it("throws when PLANKA_AGENT_EMAIL is missing", () => {
      process.env.PLANKA_AGENT_PASSWORD = "secret";
      expect(() => parseAuthConfig()).toThrow("PLANKA_AGENT_EMAIL");
    });

    it("throws when PLANKA_AGENT_PASSWORD is missing", () => {
      process.env.PLANKA_AGENT_EMAIL = "user@test.com";
      expect(() => parseAuthConfig()).toThrow("PLANKA_AGENT_PASSWORD");
    });
  });

  describe("oidc method", () => {
    it("returns oidc config with custom token file", () => {
      process.env.PLANKA_AUTH_METHOD = "oidc";
      process.env.PLANKA_TOKEN_FILE = "/tmp/my-token";
      const config = parseAuthConfig();
      expect(config).toEqual({
        method: "oidc",
        tokenFile: "/tmp/my-token",
        callbackHost: "127.0.0.1",
        callbackPort: 18931,
      });
    });

    it("uses default token path when PLANKA_TOKEN_FILE is unset", () => {
      process.env.PLANKA_AUTH_METHOD = "oidc";
      const config = parseAuthConfig();
      expect(config.method).toBe("oidc");
      if (config.method === "oidc") {
        expect(config.tokenFile).toMatch(/\.config\/kanban-mcp\/planka-token$/);
      }
    });

    it("uses custom callback host and port", () => {
      process.env.PLANKA_AUTH_METHOD = "oidc";
      process.env.PLANKA_OIDC_CALLBACK_HOST = "0.0.0.0";
      process.env.PLANKA_OIDC_CALLBACK_PORT = "9999";
      const config = parseAuthConfig();
      expect(config).toEqual({
        method: "oidc",
        tokenFile: getDefaultTokenPath(),
        callbackHost: "0.0.0.0",
        callbackPort: 9999,
      });
    });

    it("throws for invalid callback port", () => {
      process.env.PLANKA_AUTH_METHOD = "oidc";
      process.env.PLANKA_OIDC_CALLBACK_PORT = "not-a-port";
      expect(() => parseAuthConfig()).toThrow("Invalid port");
    });
  });

  describe("unknown method", () => {
    it("throws for unknown PLANKA_AUTH_METHOD", () => {
      process.env.PLANKA_AUTH_METHOD = "oauth2";
      expect(() => parseAuthConfig()).toThrow(
        "Unknown PLANKA_AUTH_METHOD: 'oauth2'",
      );
    });

    it("throws for custom method with email/password still set", () => {
      process.env.PLANKA_AUTH_METHOD = "saml";
      process.env.PLANKA_AGENT_EMAIL = "user@test.com";
      process.env.PLANKA_AGENT_PASSWORD = "secret";
      expect(() => parseAuthConfig()).toThrow(
        "Unknown PLANKA_AUTH_METHOD: 'saml'",
      );
    });
  });
});
