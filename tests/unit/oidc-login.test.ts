import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  fetchOidcBootstrap,
  generateNonce,
  parseAuthorizationUrl,
  prepareOidcLogin,
} from "../../cli/oidc-login.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status: number): Response {
  return new Response("error", { status });
}

const VALID_AUTH_URL =
  "https://identity.example/authorize?client_id=test123&scope=openid+profile&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A18931%2Fcallback&response_mode=query&provider_hint=example";

function validBootstrapBody(overrides?: {
  authorizationUrl?: string;
  isEnforced?: boolean;
  endSessionUrl?: string | null;
  oidc?: unknown;
}) {
  return {
    item: {
      oidc: {
        authorizationUrl: overrides?.authorizationUrl ?? VALID_AUTH_URL,
        isEnforced: overrides?.isEnforced ?? true,
        endSessionUrl:
          overrides?.endSessionUrl ?? "https://identity.example/end-session",
        ...overrides,
      },
    },
  };
}

describe("fetchOidcBootstrap", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sends exact bootstrap request without authentication", async () => {
    const fetchFn = jest.fn<typeof globalThis.fetch>();
    fetchFn.mockResolvedValue(jsonResponse(validBootstrapBody()));

    await fetchOidcBootstrap("https://planka.example/some/path", {
      fetch: fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(new URL(url.toString()).toString()).toBe(
      "https://planka.example/api/bootstrap",
    );
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>)?.Accept).toBe(
      "application/json",
    );
    expect(
      (init?.headers as Record<string, string>)?.Authorization,
    ).toBeUndefined();
    expect(init?.body).toBeUndefined();
  });

  it("returns parsed bootstrap data for a valid response", async () => {
    const fetchFn = jest.fn<typeof globalThis.fetch>();
    fetchFn.mockResolvedValue(jsonResponse(validBootstrapBody()));

    const result = await fetchOidcBootstrap("https://planka.example", {
      fetch: fetchFn,
    });

    expect(result.authorizationUrl).toBe(VALID_AUTH_URL);
    expect(result.isEnforced).toBe(true);
    expect(result.endSessionUrl).toBe("https://identity.example/end-session");
  });

  it("resolves origin-root path regardless of base URL path", async () => {
    const fetchFn = jest.fn<typeof globalThis.fetch>();
    fetchFn.mockResolvedValue(jsonResponse(validBootstrapBody()));

    await fetchOidcBootstrap("https://planka.example/deep/nested/path", {
      fetch: fetchFn,
    });

    const [url] = fetchFn.mock.calls[0];
    expect(new URL(url.toString()).origin).toBe("https://planka.example");
    expect(new URL(url.toString()).pathname).toBe("/api/bootstrap");
  });

  it("rejects with network failure message and preserves cause", async () => {
    const networkError = new Error("fetch failed");
    const fetchFn = jest.fn<() => Promise<Response>>();
    fetchFn.mockRejectedValue(networkError);

    await expect(
      fetchOidcBootstrap("https://planka.example", {
        fetch: fetchFn,
      }),
    ).rejects.toThrow("Failed to fetch Planka bootstrap configuration");

    try {
      await fetchOidcBootstrap("https://planka.example", {
        fetch: fetchFn,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBe(networkError);
    }
  });

  it("rejects for non-success HTTP response with status", async () => {
    const fetchFn = jest.fn<() => Promise<Response>>();
    fetchFn.mockResolvedValue(errorResponse(503));

    await expect(
      fetchOidcBootstrap("https://planka.example", {
        fetch: fetchFn,
      }),
    ).rejects.toThrow("HTTP 503");
  });

  it("rejects for invalid JSON response", async () => {
    const fetchFn = jest.fn<() => Promise<Response>>();
    fetchFn.mockResolvedValue(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      fetchOidcBootstrap("https://planka.example", {
        fetch: fetchFn,
      }),
    ).rejects.toThrow("invalid bootstrap response");
  });

  it("rejects when item.oidc is missing", async () => {
    const fetchFn = jest.fn<() => Promise<Response>>();
    fetchFn.mockResolvedValue(jsonResponse({ item: {} }));

    await expect(
      fetchOidcBootstrap("https://planka.example", {
        fetch: fetchFn,
      }),
    ).rejects.toThrow("OIDC is not configured");
  });

  it("rejects when item.oidc is null", async () => {
    const fetchFn = jest.fn<() => Promise<Response>>();
    fetchFn.mockResolvedValue(jsonResponse({ item: { oidc: null } }));

    await expect(
      fetchOidcBootstrap("https://planka.example", {
        fetch: fetchFn,
      }),
    ).rejects.toThrow("OIDC is not configured");
  });

  it("rejects when authorizationUrl is missing", async () => {
    const fetchFn = jest.fn<() => Promise<Response>>();
    fetchFn.mockResolvedValue(
      jsonResponse({
        item: {
          oidc: { isEnforced: true, endSessionUrl: null },
        },
      }),
    );

    await expect(
      fetchOidcBootstrap("https://planka.example", {
        fetch: fetchFn,
      }),
    ).rejects.toThrow("does not contain an OIDC authorization URL");
  });

  it("rejects when authorizationUrl is empty string", async () => {
    const fetchFn = jest.fn<() => Promise<Response>>();
    fetchFn.mockResolvedValue(
      jsonResponse({
        item: {
          oidc: { authorizationUrl: "", isEnforced: true },
        },
      }),
    );

    await expect(
      fetchOidcBootstrap("https://planka.example", {
        fetch: fetchFn,
      }),
    ).rejects.toThrow("does not contain an OIDC authorization URL");
  });

  it("rejects for invalid response envelope shapes", async () => {
    const fetchFn = jest.fn<() => Promise<Response>>();

    const invalidShapes = [
      {},
      { item: null },
      { item: { oidc: "enabled" } },
      { item: { oidc: { authorizationUrl: 123 } } },
    ];

    for (const body of invalidShapes) {
      fetchFn.mockResolvedValue(jsonResponse(body));
      await expect(
        fetchOidcBootstrap("https://planka.example", {
          fetch: fetchFn,
        }),
      ).rejects.toThrow();
    }
  });
});

describe("generateNonce", () => {
  it("returns a non-empty string", () => {
    const nonce = generateNonce();
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);
  });

  it("produces URL-safe characters", () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates at least 32 bytes of entropy", () => {
    const nonce = generateNonce();
    const byteLength = Math.ceil(nonce.length * (6 / 8));
    expect(byteLength).toBeGreaterThanOrEqual(32);
  });

  it("produces unique values across calls", () => {
    const nonce1 = generateNonce();
    const nonce2 = generateNonce();
    expect(nonce1).not.toBe(nonce2);
  });
});

describe("parseAuthorizationUrl", () => {
  it("parses a valid authorization URL", () => {
    const url = parseAuthorizationUrl(VALID_AUTH_URL);
    expect(url).toBeInstanceOf(URL);
    expect(url.hostname).toBe("identity.example");
  });

  it("rejects a malformed URL", () => {
    expect(() => parseAuthorizationUrl("not a valid absolute URL")).toThrow(
      "invalid OIDC authorization URL",
    );
  });

  it("rejects an empty string", () => {
    expect(() => parseAuthorizationUrl("")).toThrow(
      "invalid OIDC authorization URL",
    );
  });
});

describe("prepareOidcLogin", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns authorization URL with injected nonce", async () => {
    const fetchFn = jest.fn<() => Promise<Response>>();
    fetchFn.mockResolvedValue(jsonResponse(validBootstrapBody()));

    const result = await prepareOidcLogin("https://planka.example", {
      fetch: fetchFn,
      generateNonce: () => "test-nonce-123",
      generateState: () => "test-state-123",
    });

    expect(result.nonce).toBe("test-nonce-123");
    expect(result.expectedState).toBe("test-state-123");
    expect(result.authorizationUrl.searchParams.get("nonce")).toBe(
      "test-nonce-123",
    );
  });

  it("preserves all original authorization URL parameters", async () => {
    const fetchFn = jest.fn<() => Promise<Response>>();
    fetchFn.mockResolvedValue(jsonResponse(validBootstrapBody()));

    const result = await prepareOidcLogin("https://planka.example", {
      fetch: fetchFn,
      generateNonce: () => "test-nonce-123",
      generateState: () => "test-state-123",
    });

    const url = result.authorizationUrl;
    expect(url.searchParams.get("client_id")).toBe("test123");
    expect(url.searchParams.get("scope")).toBe("openid profile");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:18931/callback",
    );
    expect(url.searchParams.get("response_mode")).toBe("query");
    expect(url.searchParams.get("provider_hint")).toBe("example");
  });

  it("preserves encoded values and provider-specific parameters", async () => {
    const complexUrl =
      "https://idp.example/auth?client_id=c%26id&scope=openid+email+profile&response_type=code&redirect_uri=https%3A%2F%2Fapp.example%2Fcb%3Fextra%3D1&custom_param=foo%26bar";
    const fetchFn = jest.fn<() => Promise<Response>>();
    fetchFn.mockResolvedValue(
      jsonResponse(validBootstrapBody({ authorizationUrl: complexUrl })),
    );

    const result = await prepareOidcLogin("https://planka.example", {
      fetch: fetchFn,
      generateNonce: () => "test-nonce-123",
      generateState: () => "test-state-123",
    });

    const url = result.authorizationUrl;
    expect(url.searchParams.get("client_id")).toBe("c&id");
    expect(url.searchParams.get("custom_param")).toBe("foo&bar");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example/cb?extra=1",
    );
  });

  it("replaces an existing nonce with the generated one", async () => {
    const urlWithNonce =
      "https://idp.example/auth?client_id=x&nonce=old-nonce-value&response_type=code";
    const fetchFn = jest.fn<() => Promise<Response>>();
    fetchFn.mockResolvedValue(
      jsonResponse(validBootstrapBody({ authorizationUrl: urlWithNonce })),
    );

    const result = await prepareOidcLogin("https://planka.example", {
      fetch: fetchFn,
      generateNonce: () => "new-nonce-value",
      generateState: () => "new-state-value",
    });

    expect(result.authorizationUrl.searchParams.get("nonce")).toBe(
      "new-nonce-value",
    );
  });

  it("does not generate nonce if bootstrap fails", async () => {
    const fetchFn = jest.fn<() => Promise<Response>>();
    fetchFn.mockResolvedValue(errorResponse(503));
    const generateNonceFn = jest.fn<() => string>();

    await expect(
      prepareOidcLogin("https://planka.example", {
        fetch: fetchFn,
        generateNonce: generateNonceFn,
      }),
    ).rejects.toThrow("HTTP 503");

    expect(generateNonceFn).not.toHaveBeenCalled();
  });

  it("does not return an authorization URL on bootstrap failure", async () => {
    const fetchFn = jest.fn<() => Promise<Response>>();
    fetchFn.mockRejectedValue(new Error("network error"));

    await expect(
      prepareOidcLogin("https://planka.example", {
        fetch: fetchFn,
        generateNonce: () => "should-not-exist",
      }),
    ).rejects.toThrow("Failed to fetch Planka bootstrap configuration");
  });
});
