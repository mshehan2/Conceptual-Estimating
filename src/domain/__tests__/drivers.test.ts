/**
 * Program driver chains.
 *
 * Three real campus models drive area three different ways, and a single
 * blended metric covers none of them on its own. These tests hold the two
 * shapes apart and check the decomposition that makes Flad's 540 DGSF/KPU
 * arguable rather than merely quoted.
 */

import { describe, expect, it } from "vitest";
import { atDgsfPerKpu, resolveCategories, resolveChain, type DriverChain } from "../drivers";
import { TYPE_BY_ID } from "@/markets/registry";

const mob = () => TYPE_BY_ID.hc_mob.driverChain!;
const asc = () => TYPE_BY_ID.hc_asc.driverChain!;

describe("the blended chain, as Flad frames UPC 1", () => {
  it("reproduces the published UPC 1 areas exactly", () => {
    const r = resolveChain(mob());
    expect(r.kpu).toBe(120);
    expect(r.dgsf).toBe(64_800);
    expect(r.bgsf).toBe(97_200);
  });

  it("decomposes the blended metric into room and support", () => {
    const r = resolveChain(mob());
    // 112 exam at 208, 6 procedure at 500, 2 x-ray at 600.
    expect(r.roomArea).toBe(27_496);
    expect(Math.round(r.roomArea / r.kpu)).toBe(229);
    // So 540 is 229 of room and 311 of everything supporting it.
    expect(Math.round(r.dgsfPerKpu - r.roomArea / r.kpu)).toBe(311);
    expect(r.roomShare).toBeCloseTo(0.424, 3);
  });

  it("shows what the argued metrics would actually mean", () => {
    // Flad is at 540. Jamie Matthys's own comps push toward 700, unresolved.
    const at440 = atDgsfPerKpu(mob(), 440);
    const at700 = atDgsfPerKpu(mob(), 700);
    expect(at440.bgsf).toBe(79_200);
    expect(at700.bgsf).toBe(126_000);
    // At 700, only a third of departmental area is exam, procedure or imaging.
    expect(at700.roomShare).toBeCloseTo(0.327, 3);
    expect(at440.roomShare).toBeGreaterThan(at700.roomShare);
  });
});

describe("the component chain, as an ASC is planned", () => {
  it("sums each driver's own area rather than blending them", () => {
    const r = resolveChain(asc());
    // 4 OR at 650, sterile core 4 at 320, 8 PACU bays at 180, support 4 at 900.
    expect(r.dgsf).toBe(4 * 650 + 4 * 320 + 8 * 180 + 4 * 900);
    expect(r.bgsf).toBeCloseTo(r.dgsf * 1.35, 6);
  });

  it("counts only the operating rooms as key planning units", () => {
    const r = resolveChain(asc());
    // A sterile core is not a KPU, and neither is a PACU bay.
    expect(r.kpu).toBe(4);
  });

  it("lands in the range an ASC is actually built at", () => {
    const r = resolveChain(asc());
    const perOr = r.bgsf / r.kpu;
    expect(perOr).toBeGreaterThan(2_400);
    expect(perOr).toBeLessThan(3_600);
  });

  it("scales with the OR count, carrying its dependants", () => {
    const chain = asc();
    const bigger: DriverChain = {
      ...chain,
      drivers: chain.drivers.map((d) =>
        d.id === "or" || d.unit === "per OR" ? { ...d, count: 8 } : d,
      ),
    };
    const r4 = resolveChain(chain);
    const r8 = resolveChain(bigger);
    expect(r8.kpu).toBe(8);
    // PACU did not double, so area rises but not by exactly two.
    expect(r8.dgsf / r4.dgsf).toBeGreaterThan(1.7);
    expect(r8.dgsf / r4.dgsf).toBeLessThan(2);
  });
});

describe("category shares always account for the whole building", () => {
  it("gives the balance category the remainder", () => {
    const r = resolveChain(mob());
    const circ = r.categories.find((c) => c.id === "circulation")!;
    expect(circ.share).toBeCloseTo(0.31, 6);
    expect(r.categories.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1, 9);
    expect(r.categories.reduce((a, c) => a + c.area, 0)).toBeCloseTo(r.bgsf, 6);
  });

  it("carries all twelve of Flad's benchmarking categories", () => {
    const labels = resolveChain(mob()).categories.map((c) => c.label);
    for (const want of [
      "Diagnostic & Treatment", "Care Support", "Lab", "Lab Support",
      "Office", "Office Support", "Formal Collaboration", "Informal Collaboration",
      "Building Support", "Building Service", "Mechanical & Building Service", "Circulation",
    ]) {
      expect(labels, want).toContain(want);
    }
  });

  it("normalizes a set that does not sum to one when there is no balance", () => {
    // Flad's issued Crescent chart sums to 91%, because its stacked bar
    // carries bands nobody could read. Areas must still cover the building.
    const cats = resolveCategories(
      [
        { id: "a", label: "A", share: 0.5 },
        { id: "b", label: "B", share: 0.41 },
      ],
      100_000,
    );
    expect(cats.reduce((a, c) => a + c.area, 0)).toBeCloseTo(100_000, 6);
    expect(cats[0].share).toBeCloseTo(0.5 / 0.91, 9);
  });

  it("does not go negative when the named shares overrun", () => {
    const cats = resolveCategories(
      [
        { id: "a", label: "A", share: 0.8 },
        { id: "b", label: "B", share: 0.5 },
        { id: "c", label: "Balance", share: 0, balance: true },
      ],
      100_000,
    );
    expect(cats.find((c) => c.balance)!.area).toBe(0);
  });
});

describe("every chain in the registry is coherent", () => {
  it("has drivers, a gross factor and categories that resolve", () => {
    for (const t of Object.values(TYPE_BY_ID)) {
      if (!t.driverChain) continue;
      const r = resolveChain(t.driverChain);
      expect(r.dgsf, t.id).toBeGreaterThan(0);
      expect(r.bgsf, t.id).toBeGreaterThan(r.dgsf);
      expect(r.categories.reduce((a, c) => a + c.share, 0), t.id).toBeCloseTo(1, 9);
      expect(r.categories.every((c) => c.share >= 0), t.id).toBe(true);
      if (t.driverChain.mode === "blended") expect(t.driverChain.dgsfPerKpu, t.id).toBeGreaterThan(0);
    }
  });
});
