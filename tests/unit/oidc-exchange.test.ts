import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  type ExchangeOidcCodeInput,
  exchangeOidcCode,
} from "../../operations/oidc.js";

const code = "SECRET_AUTHORIZATION_CODE";
const nonce = "SECRET_NONCE";
const token = "SECRET_ACCESS_TOKEN";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function input(): ExchangeOidcCodeInput {
  return { code, nonce };
}

describe("exchangeOidcCode", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sends the exact unauthenticated exchange request", async () => {
    const fetchFn = jest
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ item: token }));

    await expect(
      exchangeOidcCode("https://planka.example/deep/api", input(), {
        fetch: fetchFn,
      }),
    ).resolves.toEqual({ accessToken: token });

    const [request, init] = fetchFn.mock.calls[0];
    expect(new URL(request.toString()).toString()).toBe(
      "https://planka.example/api/access-tokens/exchange-with-oidc",
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    const headers = init?.headers as Record<string, string>;
    expect(
      Object.keys(headers).some(
        (name) => name.toLowerCase() === "authorization",
      ),
    ).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({
      code,
      nonce,
      withHttpOnlyToken: false,
    });
  });

  it.each([
    {},
    { item: null },
    { item: 42 },
    { item: "" },
    { item: "   " },
  ])("rejects an invalid successful response", async (body) => {
    const fetchFn = jest
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(body));

    await expect(
      exchangeOidcCode("https://planka.example", input(), { fetch: fetchFn }),
    ).rejects.toThrow("invalid OIDC token-exchange response");
  });

  it("rejects malformed JSON on a successful response", async () => {
    const fetchFn = jest
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("not-json", { status: 200 }));

    await expect(
      exchangeOidcCode("https://planka.example", input(), { fetch: fetchFn }),
    ).rejects.toThrow("invalid OIDC token-exchange response");
  });

  it.each([
    [401, "rejected the OIDC authorization code"],
    [403, "denied the OIDC token exchange"],
    [409, "token-exchange conflict"],
    [422, "could not process the OIDC token exchange"],
    [500, "server error during OIDC token exchange"],
  ])("reports HTTP %s safely", async (status: number, message: string) => {
    const fetchFn = jest
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ message: code, item: token }, status));

    let thrown: unknown;
    try {
      await exchangeOidcCode("https://planka.example", input(), {
        fetch: fetchFn,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const thrownMessage =
      thrown instanceof Error ? thrown.message : String(thrown);
    expect(thrownMessage).toContain(message);
    expect(thrownMessage).not.toContain(code);
    expect(thrownMessage).not.toContain(nonce);
    expect(thrownMessage).not.toContain(token);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("recognizes the terms gate without exposing its pending token", async () => {
    const pendingToken = "SECRET_PENDING_TOKEN";
    const fetchFn = jest
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ step: "accept-terms", pendingToken }, 403));

    let thrown: unknown;
    try {
      await exchangeOidcCode("https://planka.example", input(), {
        fetch: fetchFn,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const thrownMessage =
      thrown instanceof Error ? thrown.message : String(thrown);
    expect(thrownMessage).toContain("accept the terms");
    expect(thrownMessage).not.toContain(pendingToken);
    expect(thrownMessage).not.toContain(code);
    expect(thrownMessage).not.toContain(nonce);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("does not treat an incomplete terms shape as a successful token response", async () => {
    const fetchFn = jest
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ step: "accept-terms" }, 200));

    await expect(
      exchangeOidcCode("https://planka.example", input(), { fetch: fetchFn }),
    ).rejects.toThrow("invalid OIDC token-exchange response");
  });

  it("reports network failure without retrying", async () => {
    const fetchFn = jest
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error(`network failure for ${code}`));

    await expect(
      exchangeOidcCode("https://planka.example", input(), { fetch: fetchFn }),
    ).rejects.toThrow("Failed to contact Planka for OIDC token exchange");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
