/**
 * Unit-test helpers for stubbing the global `fetch` that common/utils.ts calls
 * directly. No new dependency: a `jest.spyOn(globalThis, "fetch")` captures the
 * exact URL / method / body / headers the code under test sends.
 */
import { jest } from "@jest/globals";

export interface MockResult {
  /** HTTP status (default 200). */
  status?: number;
  /** Response body (default {}). Serialized as JSON unless contentType says otherwise. */
  body?: unknown;
  /** Response content-type (default application/json). */
  contentType?: string;
}

/** Decides the response for a given request. Return undefined for a default 200 {}. */
export type FetchResponder = (
  url: string,
  init: RequestInit | undefined,
) => MockResult | undefined;

/** Builds a Response with the right content-type so parseResponseBody picks JSON vs text. */
export function jsonResponse(
  body: unknown,
  status = 200,
  contentType = "application/json",
): Response {
  const text = contentType.includes("json") ? JSON.stringify(body) : String(body);
  return new Response(text, { status, headers: { "content-type": contentType } });
}

/**
 * Spies on global fetch.
 * - `/api/access-tokens` always resolves to { item: "test-token" } so the
 *   authenticateAgent() step in plankaRequest succeeds without a real server.
 * - Everything else is routed through `responder`; an undefined result yields 200 {}.
 *
 * Pair with `afterEach(() => jest.restoreAllMocks())`.
 */
export function mockFetch(responder?: FetchResponder) {
  const spy = jest.spyOn(globalThis, "fetch");
  spy.mockImplementation(((input: unknown, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    if (url.includes("/api/access-tokens")) {
      return Promise.resolve(jsonResponse({ item: "test-token" }));
    }
    const result = responder?.(url, init);
    return Promise.resolve(
      jsonResponse(result?.body ?? {}, result?.status ?? 200, result?.contentType),
    );
  }) as unknown as typeof fetch);
  return spy;
}

type FetchSpy = ReturnType<typeof mockFetch>;

export interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

/** All recorded fetch calls except the auth handshake, as { url, init }. */
export function businessCalls(spy: FetchSpy): RecordedCall[] {
  return spy.mock.calls
    .map((args) => ({ url: urlOf(args[0]), init: args[1] }))
    .filter((c) => !c.url.includes("/api/access-tokens"));
}

/** The single business call — fails loudly if there isn't exactly one. */
export function onlyBusinessCall(spy: FetchSpy): RecordedCall {
  const calls = businessCalls(spy);
  if (calls.length !== 1) {
    throw new Error(`Expected exactly 1 business call, saw ${calls.length}: ${calls.map((c) => c.url).join(", ")}`);
  }
  return calls[0];
}

export function methodOf(init: RequestInit | undefined): string {
  return (init?.method ?? "GET").toUpperCase();
}

export function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers as Record<string, string>) ?? {};
}

/** Parses a JSON string body back to an object (operations pass JSON.stringify'd bodies). */
export function jsonBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  return typeof body === "string" ? JSON.parse(body) : body;
}

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === "object" && "url" in input) {
    return String((input as { url: unknown }).url);
  }
  return String(input);
}
