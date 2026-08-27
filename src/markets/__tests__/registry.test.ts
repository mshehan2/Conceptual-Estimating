import { describe, expect, it } from "vitest";
import { BUILDING_TYPES, MARKETS, UNIT_CATALOG, validateRegistry } from "../registry";

describe("market registry", () => {
  it("has no structural problems", () => {
    expect(validateRegistry()).toEqual([]);
  });

  it("covers every market with at least one building type", () => {
    for (const m of MARKETS) expect(m.typeIds.length).toBeGreaterThan(0);
  });

  it("is non-trivial", () => {
    expect(MARKETS.length).toBeGreaterThanOrEqual(8);
    expect(BUILDING_TYPES.length).toBeGreaterThanOrEqual(30);
    expect(UNIT_CATALOG.length).toBeGreaterThanOrEqual(60);
  });
});
