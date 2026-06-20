import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  buildUrl,
  plankaRequest,
  validateBoardName,
  validateCardName,
  validateListName,
  validateProjectName,
} from "../../common/utils.js";
import {
  businessCalls,
  headersOf,
  jsonBody,
  methodOf,
  mockFetch,
  onlyBusinessCall,
} from "./helpers.js";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("buildUrl", () => {
  it("appends query parameters", () => {
    const result = buildUrl("http://h.test/api/projects", { page: 1, perPage: 10 });
    const url = new URL(result);
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("perPage")).toBe("10");
  });

  it("skips undefined parameters", () => {
    const result = buildUrl("http://h.test/api/projects", {
      page: 1,
      cursor: undefined,
    });
    const url = new URL(result);
    expect(url.searchParams.has("cursor")).toBe(false);
    expect(url.searchParams.get("page")).toBe("1");
  });

  it("encodes special characters in values", () => {
    const result = buildUrl("http://h.test/api/search", { q: "a b&c=d" });
    // Round-trip through URL to assert the value survives encoding intact.
    expect(new URL(result).searchParams.get("q")).toBe("a b&c=d");
    // And the raw string is percent/plus encoded, not literal.
    expect(result).not.toContain("a b&c=d");
  });
});

describe("validate*Name", () => {
  const validators: Array<[string, (name: string) => string]> = [
    ["validateProjectName", validateProjectName],
    ["validateBoardName", validateBoardName],
    ["validateListName", validateListName],
    ["validateCardName", validateCardName],
  ];

  for (const [name, fn] of validators) {
    it(`${name} trims surrounding whitespace`, () => {
      expect(fn("  Hello  ")).toBe("Hello");
    });

    it(`${name} throws on empty / whitespace-only input`, () => {
      expect(() => fn("")).toThrow();
      expect(() => fn("   ")).toThrow();
    });
  }
});

describe("plankaRequest", () => {
  it("strips a trailing /api from PLANKA_BASE_URL (no /api/api)", async () => {
    const original = process.env.PLANKA_BASE_URL;
    process.env.PLANKA_BASE_URL = "http://localhost:3333/api";
    try {
      const spy = mockFetch();
      await plankaRequest("/api/projects", { skipAuth: true });
      expect(onlyBusinessCall(spy).url).toBe("http://localhost:3333/api/projects");
    } finally {
      process.env.PLANKA_BASE_URL = original;
    }
  });

  it("prefixes /api/ when the path does not start with it", async () => {
    const spy = mockFetch();
    await plankaRequest("projects", { skipAuth: true });
    expect(onlyBusinessCall(spy).url).toBe("http://localhost:3333/api/projects");
  });

  it("attaches an Authorization: Bearer header from the access token", async () => {
    const spy = mockFetch();
    await plankaRequest("/api/projects");
    const call = businessCalls(spy)[0];
    expect(headersOf(call.init).Authorization).toBe("Bearer test-token");
  });

  it("does not attach Authorization when skipAuth is set", async () => {
    const spy = mockFetch();
    await plankaRequest("/api/projects", { skipAuth: true });
    expect(headersOf(onlyBusinessCall(spy).init).Authorization).toBeUndefined();
  });

  it("removes the Content-Type header for FormData bodies", async () => {
    const spy = mockFetch();
    await plankaRequest("/api/cards/c1/attachments", {
      method: "POST",
      body: new FormData(),
      skipAuth: true,
    });
    const headers = headersOf(onlyBusinessCall(spy).init);
    expect(headers["Content-Type"]).toBeUndefined();
    // The other default headers survive.
    expect(headers.Accept).toBe("application/json");
  });

  it("JSON-stringifies object bodies and sets the method", async () => {
    const spy = mockFetch();
    await plankaRequest("/api/projects", {
      method: "POST",
      body: { name: "demo" },
      skipAuth: true,
    });
    const call = onlyBusinessCall(spy);
    expect(methodOf(call.init)).toBe("POST");
    expect(jsonBody(call.init)).toEqual({ name: "demo" });
  });

  it("throws when the response is not ok", async () => {
    mockFetch(() => ({ status: 422, body: { message: "Validation failed" } }));
    await expect(plankaRequest("/api/projects", { skipAuth: true })).rejects.toThrow(
      "Validation failed",
    );
  });
});
