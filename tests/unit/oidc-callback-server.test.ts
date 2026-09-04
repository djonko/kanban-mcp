import { createServer, request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  getCallbackExpectation,
  startOidcCallbackServer,
} from "../../cli/oidc-callback-server.js";
import { prepareOidcLogin } from "../../cli/oidc-login.js";

const handles: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

function start(options: Parameters<typeof startOidcCallbackServer>[0]) {
  return startOidcCallbackServer(options).then((handle) => {
    handles.push(handle);
    return handle;
  });
}

describe("startOidcCallbackServer", () => {
  it("captures a successful query callback and closes", async () => {
    const handle = await start({
      port: 0,
      callbackPath: "/callback",
      responseMode: "query",
      expectedState: "expected-state",
    });
    const response = await fetch(
      `${handle.callbackUrl}?code=test-code&state=expected-state`,
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("test-code");
    expect(body).not.toContain("expected-state");
    await expect(handle.waitForCallback).resolves.toEqual({
      code: "test-code",
    });

    await expect(fetch(handle.callbackUrl)).rejects.toThrow();
  });

  it("rejects provider errors only after validating state", async () => {
    const handle = await start({
      port: 0,
      callbackPath: "/callback",
      responseMode: "query",
      expectedState: "expected-state",
    });
    const result = handle.waitForCallback;
    const resultAssertion = expect(result).rejects.toThrow(
      "state does not match",
    );

    const response = await fetch(
      `${handle.callbackUrl}?error=access_denied&error_description=private&state=wrong`,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private");
    await resultAssertion;

    const deniedHandle = await start({
      port: 0,
      callbackPath: "/callback",
      responseMode: "query",
      expectedState: "expected-state",
    });
    const deniedResult = deniedHandle.waitForCallback;
    const deniedAssertion = expect(deniedResult).rejects.toThrow(
      "provider denied authorization: access_denied",
    );
    const deniedResponse = await fetch(
      `${deniedHandle.callbackUrl}?error=access_denied&error_description=private&state=expected-state`,
    );
    expect(deniedResponse.status).toBe(400);
    expect(await deniedResponse.text()).not.toContain("private");
    await deniedAssertion;
  });

  it("rejects missing, mismatched, and duplicate state", async () => {
    for (const query of [
      "code=c",
      "code=c&state=wrong",
      "code=c&state=a&state=a",
    ]) {
      const handle = await start({
        port: 0,
        callbackPath: "/callback",
        responseMode: "query",
        expectedState: "expected",
      });
      const result = handle.waitForCallback;
      const resultAssertion = expect(result).rejects.toThrow();
      const response = await fetch(`${handle.callbackUrl}?${query}`);
      expect(response.status).toBe(400);
      await resultAssertion;
    }
  });

  it("leaves the listener active for unrelated routes and wrong methods", async () => {
    const handle = await start({
      port: 0,
      callbackPath: "/callback",
      responseMode: "query",
      expectedState: "state",
    });

    expect((await fetch(`${handle.origin}/favicon.ico`)).status).toBe(404);
    const methodResponse = await fetch(handle.callbackUrl, { method: "POST" });
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get("allow")).toBe("GET");
    const validResponse = await fetch(
      `${handle.callbackUrl}?code=c&state=state`,
    );
    expect(validResponse.status).toBe(200);
    await expect(handle.waitForCallback).resolves.toEqual({ code: "c" });
  });

  it("requires the exact callback route and rejects a missing code", async () => {
    const handle = await start({
      port: 0,
      callbackPath: "/callback",
      responseMode: "query",
      expectedState: "state",
    });
    expect((await fetch(`${handle.origin}/callback/`)).status).toBe(404);
    expect((await fetch(`${handle.origin}/callback/nested`)).status).toBe(404);

    const result = handle.waitForCallback;
    const resultAssertion =
      expect(result).rejects.toThrow("authorization code");
    const response = await fetch(`${handle.callbackUrl}?state=state`);
    expect(response.status).toBe(400);
    await resultAssertion;
  });

  it("relays fragment parameters through the same path", async () => {
    const handle = await start({
      port: 0,
      callbackPath: "/callback",
      responseMode: "fragment",
      expectedState: "state",
    });

    const relayResponse = await fetch(`${handle.callbackUrl}?code=ignored`);
    const relayBody = await relayResponse.text();
    expect(relayResponse.status).toBe(200);
    expect(relayResponse.headers.get("cache-control")).toBe("no-store");
    expect(relayBody).not.toContain("ignored");
    expect(relayBody).not.toContain("state");

    const postResponse = await fetch(handle.callbackUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "code=fragment-code&state=state",
    });
    expect(postResponse.status).toBe(200);
    expect(await postResponse.text()).toContain(
      "Authentication response received",
    );
    await expect(handle.waitForCallback).resolves.toEqual({
      code: "fragment-code",
    });
  });

  it("settles only the first of two callback requests", async () => {
    const handle = await start({
      port: 0,
      callbackPath: "/callback",
      responseMode: "query",
      expectedState: "state",
    });
    const first = fetch(`${handle.callbackUrl}?code=first&state=state`);
    const second = fetch(`${handle.callbackUrl}?code=second&state=state`);
    const responses = await Promise.allSettled([first, second]);
    const statuses = responses
      .filter(
        (response): response is PromiseFulfilledResult<Response> =>
          response.status === "fulfilled",
      )
      .map((response) => response.value.status);
    expect(statuses).toContain(200);
    expect(statuses.every((status) => status === 200 || status === 410)).toBe(
      true,
    );
    await expect(handle.waitForCallback).resolves.toEqual({ code: "first" });
  });

  it("forces closed stalled fragment POSTs at timeout", async () => {
    const handle = await start({
      port: 0,
      callbackPath: "/callback",
      responseMode: "fragment",
      expectedState: "state",
      timeoutMs: 40,
    });
    const stalled = httpRequest(
      {
        hostname: "127.0.0.1",
        port: Number(handle.callbackUrl.port),
        path: "/callback",
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "content-length": "100",
        },
      },
      () => {},
    );
    stalled.on("error", () => {});
    stalled.write("code=partial");
    await expect(handle.waitForCallback).rejects.toThrow("Timed out waiting");
    stalled.destroy();
  });

  it("rejects invalid fragment submissions and bounds their body", async () => {
    for (const submission of [
      { headers: { "content-type": "text/plain" }, body: "code=c" },
      {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `${"x".repeat(8 * 1024)}x`,
      },
      {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "code=%not-valid",
      },
    ]) {
      const handle = await start({
        port: 0,
        callbackPath: "/callback",
        responseMode: "fragment",
        expectedState: "state",
      });
      const result = handle.waitForCallback;
      const resultAssertion = expect(result).rejects.toThrow();
      const response = await fetch(handle.callbackUrl, {
        method: "POST",
        headers: submission.headers,
        body: submission.body,
      });
      expect(response.status).toBe(400);
      await resultAssertion;
    }
  });

  it("times out and supports idempotent explicit close", async () => {
    const timeoutHandle = await start({
      port: 0,
      callbackPath: "/callback",
      responseMode: "query",
      expectedState: "state",
      timeoutMs: 40,
    });
    await expect(timeoutHandle.waitForCallback).rejects.toThrow(
      "Timed out waiting",
    );
    await timeoutHandle.close();

    const closeHandle = await start({
      port: 0,
      callbackPath: "/callback",
      responseMode: "query",
      expectedState: "state",
      timeoutMs: 1_000,
    });
    const result = closeHandle.waitForCallback;
    await closeHandle.close();
    await closeHandle.close();
    await expect(result).rejects.toThrow("closed before login completed");
  });

  it("rejects an occupied port without leaving a server running", async () => {
    const occupied = createServer();
    await new Promise<void>((resolve) =>
      occupied.listen(0, "127.0.0.1", resolve),
    );
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("No address");

    try {
      await expect(
        startOidcCallbackServer({
          port: address.port,
          callbackPath: "/callback",
          responseMode: "query",
          expectedState: "state",
        }),
      ).rejects.toThrow("Failed to start");
    } finally {
      await new Promise<void>((resolve, reject) => {
        occupied.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

describe("getCallbackExpectation", () => {
  it("derives the path, mode, and state without conflating nonce", () => {
    const prepared = {
      authorizationUrl: new URL(
        "https://idp.example/authorize?response_type=code&response_mode=fragment&nonce=nonce-value&state=state-value&redirect_uri=http%3A%2F%2F127.0.0.1%3A18931%2Foidc-callback",
      ),
      nonce: "nonce-value",
      expectedState: "state-value",
    };
    expect(
      getCallbackExpectation(prepared, {
        method: "oidc",
        tokenFile: "/tmp/token",
        callbackHost: "127.0.0.1",
        callbackPort: 18931,
      }),
    ).toEqual({
      host: "127.0.0.1",
      port: 18931,
      path: "/oidc-callback",
      responseMode: "fragment",
      expectedState: "state-value",
    });
  });

  it("derives expectations from actual preparation output", async () => {
    const fetchFn = jest.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          item: {
            oidc: {
              authorizationUrl:
                "https://idp.example/authorize?response_type=code&response_mode=query&redirect_uri=http%3A%2F%2F127.0.0.1%3A18931%2Fcallback",
            },
          },
        }),
      ),
    );
    const prepared = await prepareOidcLogin("https://planka.example", {
      fetch: fetchFn,
      generateNonce: () => "nonce-value",
      generateState: () => "state-value",
    });
    expect(
      getCallbackExpectation(prepared, {
        method: "oidc",
        tokenFile: "/tmp/token",
        callbackHost: "127.0.0.1",
        callbackPort: 18931,
      }).expectedState,
    ).toBe("state-value");
  });

  it("rejects callback paths containing URL components", async () => {
    await expect(
      startOidcCallbackServer({
        port: 0,
        callbackPath: "/callback?unexpected=true",
        responseMode: "query",
        expectedState: "state",
      }),
    ).rejects.toThrow("absolute path");
    await expect(
      startOidcCallbackServer({
        host: "0.0.0.0",
        port: 0,
        callbackPath: "/callback",
        responseMode: "query",
        expectedState: "state",
      }),
    ).rejects.toThrow("loopback address");
  });

  it("rejects a Planka web redirect or unsupported mode", () => {
    const prepared = {
      authorizationUrl: new URL(
        "https://idp.example/authorize?response_mode=fragment&redirect_uri=https%3A%2F%2Fplanka.example%2Foidc-callback",
      ),
      nonce: "nonce-value",
      expectedState: "state-value",
    };
    expect(() =>
      getCallbackExpectation(prepared, {
        method: "oidc",
        tokenFile: "/tmp/token",
        callbackHost: "127.0.0.1",
        callbackPort: 18931,
      }),
    ).toThrow("does not target the configured loopback callback");

    prepared.authorizationUrl.searchParams.set(
      "redirect_uri",
      "http://127.0.0.1:18931/callback",
    );
    prepared.authorizationUrl.searchParams.set("response_mode", "form_post");
    expect(() =>
      getCallbackExpectation(prepared, {
        method: "oidc",
        tokenFile: "/tmp/token",
        callbackHost: "127.0.0.1",
        callbackPort: 18931,
      }),
    ).toThrow("Unsupported Planka OIDC response mode: form_post");
  });
});
