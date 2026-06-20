/**
 * Harness derisk spike (plan step 1).
 *
 * Confirms the three things the rest of the unit suite depends on before we
 * build it out:
 *   1. ts-jest transpiles TS under ESM (`useESM`).
 *   2. An ESM source import with a `.js` specifier resolves to the `.ts`
 *      source via moduleNameMapper.
 *   3. `jest.spyOn(globalThis, "fetch")` intercepts the global fetch the code
 *      calls directly.
 */
import { describe, expect, it, jest } from "@jest/globals";
import { buildUrl } from "../../common/utils.js";

describe("harness spike: ESM + ts-jest + fetch spy", () => {
  it("resolves an ESM source import (.js specifier → .ts)", () => {
    expect(buildUrl("http://x.test/api/projects", { page: 1 })).toBe(
      "http://x.test/api/projects?page=1",
    );
  });

  it("can spy on global fetch", async () => {
    const spy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    await fetch("http://x.test/ping");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("http://x.test/ping");
    spy.mockRestore();
  });
});
