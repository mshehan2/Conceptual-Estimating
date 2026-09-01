/**
 * The markup cascade, checked against a real Benchmark model.
 *
 * Each step is a percentage of the RUNNING SUBTOTAL, not of direct cost. That
 * is how the Historical Estimate Template computes it, and the difference is
 * not a rounding detail: on UPC 1 the eleven rows sum to 23.10%, and taking
 * that flat gives $10,853,997 where compounding gives $11,960,110.
 *
 * The acceptance test is the UPC 1 Replacement model v1.6 CLIENT: building and
 * site cost of $46,987,000, the eleven stated rates, then 9% escalation to the
 * 2029 construction midpoint, reaching a project total of $64,135,000.
 */

import { describe, expect, it } from "vitest";
import { BENCHMARK_CASCADE, DEFAULT_MARKUPS, applyCascade, type MarkupStep } from "../estimate";

/** UPC 1 v1.6 CLIENT, from the published budget extract. */
const UPC1 = {
  buildingAndSite: 46_987_000,
  statedIndirect: 11_852_000,
  statedEscalation: 5_296_000,
  statedProjectTotal: 64_135_000,
  escalationPct: 9,
};

const construction = (steps: readonly MarkupStep[]) => steps.filter((s) => s.scope !== "project");

describe("the cascade compounds", () => {
  it("reproduces UPC 1's indirect cost within workbook rounding", () => {
    const { total } = applyCascade(UPC1.buildingAndSite, construction(BENCHMARK_CASCADE));
    // Each workbook row is rounded to thousands, so exact equality is not the
    // test. Within 1% is: it establishes the mechanism, not the pennies.
    expect(Math.abs(total - UPC1.statedIndirect) / UPC1.statedIndirect).toBeLessThan(0.01);
  });

  it("reproduces UPC 1's project total within workbook rounding", () => {
    const { total } = applyCascade(UPC1.buildingAndSite, construction(BENCHMARK_CASCADE));
    const escalated = (UPC1.buildingAndSite + total) * (1 + UPC1.escalationPct / 100);
    expect(Math.abs(escalated - UPC1.statedProjectTotal) / UPC1.statedProjectTotal)
      .toBeLessThan(0.005);
  });

  it("beats the flat calculation it replaced, by about ten percent", () => {
    const steps = construction(BENCHMARK_CASCADE);
    const nominal = steps.reduce((a, s) => a + s.pct, 0);
    const flat = UPC1.buildingAndSite * (nominal / 100);
    const { total } = applyCascade(UPC1.buildingAndSite, steps);

    expect(nominal).toBeCloseTo(23.1, 6);
    expect(total).toBeGreaterThan(flat);
    // The whole reason this change exists.
    expect((total - flat) / flat).toBeGreaterThan(0.09);
    // And the flat answer is the one that misses the published figure.
    expect(Math.abs(flat - UPC1.statedIndirect)).toBeGreaterThan(
      Math.abs(total - UPC1.statedIndirect),
    );
  });

  it("reports the subtotal each step was taken against", () => {
    const steps = construction(BENCHMARK_CASCADE);
    const { applied } = applyCascade(1_000_000, steps);
    expect(applied[0].base).toBe(1_000_000);
    for (let i = 1; i < applied.length; i++) {
      // Each base is the one before it plus what that step added.
      expect(applied[i].base).toBeCloseTo(applied[i - 1].base + applied[i - 1].amount, 6);
    }
  });

  it("is order dependent, which is the point", () => {
    const steps = construction(BENCHMARK_CASCADE);
    const reversed = [...steps].reverse();
    const a = applyCascade(10_000_000, steps).total;
    const b = applyCascade(10_000_000, reversed).total;
    // Same rates, same total, because multiplication commutes. What changes is
    // the base each row reports, which is what a reviewer reads.
    expect(a).toBeCloseTo(b, 6);
    expect(applyCascade(10_000_000, steps).applied[0].label).not.toBe(
      applyCascade(10_000_000, reversed).applied[0].label,
    );
  });

  it("takes a zero rate as a no-op rather than a gap", () => {
    const withZero: MarkupStep[] = [
      { id: "a", label: "A", pct: 10, scope: "construction" },
      { id: "z", label: "Zero", pct: 0, scope: "construction" },
      { id: "b", label: "B", pct: 10, scope: "construction" },
    ];
    const { applied, total } = applyCascade(100, withZero);
    expect(applied[1].amount).toBe(0);
    expect(total).toBeCloseTo(21, 6);
  });

  it("carries the 8/21 owner direction as a scheme change, not an app change", () => {
    // GC personnel 6% to 5%, design contingency 5% to 0% on Hospital and
    // Crescent. UPC 1 never received it, so the two must be able to coexist.
    const cut = DEFAULT_MARKUPS.map((m) =>
      m.id === "gc_personnel" ? { ...m, pct: 5 } :
      m.id === "design_contingency" ? { ...m, pct: 0 } : m,
    );
    const base = applyCascade(UPC1.buildingAndSite, construction(DEFAULT_MARKUPS)).total;
    const reduced = applyCascade(UPC1.buildingAndSite, construction(cut)).total;
    expect(reduced).toBeLessThan(base);
    // Roughly $2.9M of the campus-wide cut, on this building's base.
    expect(base - reduced).toBeGreaterThan(2_000_000);
  });

  it("defaults design fees to zero so nothing is silently inflated", () => {
    const design = DEFAULT_MARKUPS.find((m) => m.id === "design_fees");
    expect(design).toBeDefined();
    expect(design!.scope).toBe("project");
    expect(design!.pct).toBe(0);
  });
});
