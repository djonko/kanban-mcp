import { describe, expect, it } from "@jest/globals";
import {
  createPlankaError,
  isPlankaError,
  PlankaAuthenticationError,
  PlankaConflictError,
  PlankaError,
  PlankaPermissionError,
  PlankaRateLimitError,
  PlankaResourceNotFoundError,
  PlankaValidationError,
} from "../../common/errors.js";

describe("createPlankaError", () => {
  it("maps 401 to PlankaAuthenticationError", () => {
    const err = createPlankaError(401, { message: "nope" });
    expect(err).toBeInstanceOf(PlankaAuthenticationError);
    expect(err.status).toBe(401);
    expect(err.message).toBe("nope");
    expect(err.name).toBe("PlankaAuthenticationError");
  });

  it("falls back to a default message for 401 without one", () => {
    const err = createPlankaError(401, {});
    expect(err.message).toBe("Authentication failed");
  });

  it("maps 403 to PlankaPermissionError", () => {
    const err = createPlankaError(403, { message: "forbidden" });
    expect(err).toBeInstanceOf(PlankaPermissionError);
    expect(err.status).toBe(403);
    expect(err.message).toBe("forbidden");
  });

  it("maps 404 to PlankaResourceNotFoundError using the response message as the resource", () => {
    const err = createPlankaError(404, { message: "Card" });
    expect(err).toBeInstanceOf(PlankaResourceNotFoundError);
    expect(err.status).toBe(404);
    expect(err.message).toBe("Resource not found: Card");
  });

  it("defaults the 404 resource label when none is given", () => {
    const err = createPlankaError(404, {});
    expect(err.message).toBe("Resource not found: Resource");
  });

  it("maps 409 to PlankaConflictError", () => {
    const err = createPlankaError(409, { message: "dup" });
    expect(err).toBeInstanceOf(PlankaConflictError);
    expect(err.status).toBe(409);
    expect(err.message).toBe("dup");
  });

  it("maps 422 to PlankaValidationError and preserves the response", () => {
    const response = { message: "bad input", problems: ["name"] };
    const err = createPlankaError(422, response);
    expect(err).toBeInstanceOf(PlankaValidationError);
    expect(err.status).toBe(422);
    expect(err.message).toBe("bad input");
    expect(err.response).toEqual(response);
  });

  it("maps 429 to PlankaRateLimitError, parsing reset_at when present", () => {
    const err = createPlankaError(429, {
      message: "slow down",
      reset_at: "2030-01-01T00:00:00.000Z",
    }) as PlankaRateLimitError;
    expect(err).toBeInstanceOf(PlankaRateLimitError);
    expect(err.status).toBe(429);
    expect(err.resetAt.toISOString()).toBe("2030-01-01T00:00:00.000Z");
  });

  it("defaults the 429 resetAt to ~60s out when reset_at is absent", () => {
    const before = Date.now();
    const err = createPlankaError(429, {}) as PlankaRateLimitError;
    const after = Date.now();
    expect(err).toBeInstanceOf(PlankaRateLimitError);
    // resetAt should land within the [before+60s, after+60s] window.
    expect(err.resetAt.getTime()).toBeGreaterThanOrEqual(before + 60000);
    expect(err.resetAt.getTime()).toBeLessThanOrEqual(after + 60000);
  });

  it("maps unknown statuses to the base PlankaError", () => {
    const err = createPlankaError(500, { message: "boom" });
    expect(err).toBeInstanceOf(PlankaError);
    expect(err.constructor).toBe(PlankaError);
    expect(err.status).toBe(500);
    expect(err.message).toBe("boom");
  });

  it("uses a generic message for an unknown status without one", () => {
    const err = createPlankaError(503, {});
    expect(err.message).toBe("Planka API error");
  });
});

describe("isPlankaError", () => {
  it("returns true for a PlankaError instance", () => {
    expect(isPlankaError(createPlankaError(404, {}))).toBe(true);
  });

  it("returns false for a plain Error", () => {
    expect(isPlankaError(new Error("nope"))).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isPlankaError("string")).toBe(false);
    expect(isPlankaError(null)).toBe(false);
    expect(isPlankaError(undefined)).toBe(false);
  });
});
