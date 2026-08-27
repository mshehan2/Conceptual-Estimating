import { describe, expect, it } from "vitest";
import { CostResolver } from "@/costs/resolver";
import { SeedCostSource } from "@/costs/sources/seedSource";
import { OverrideCostSource } from "@/costs/sources/overrideSource";
import { makeMass, makeMassForType, envelopeTakeoff, belowGradeTakeoff, facadeCardinal } from "../massing";
import { capacity, circulation, fitFootprint, seedProgramForType, netProgramArea } from "../program";
import { takeoff } from "../takeoff";
import { estimateScheme, priceBottomUp, reconcile } from "../estimate";
import { BUILDING_TYPES } from "@/markets/registry";

const resolver = () => new CostResolver().register(new SeedCostSource());

describe("envelope takeoff", () => {
  it("splits a facade into glass and opaque without double counting", () => {
    const m = makeMass({ w: 100, d: 50, floors: 2, fth: 10, glz: "strip", cov: 50, glassH: 4, sill: 3 });
    const env = envelopeTakeoff(m);
    expect(env.grossWall).toBeCloseTo(2 * (100 + 50) * 20, 5);
    expect(env.glass + env.opaque).toBeCloseTo(env.grossWall, 5);
    expect(env.glass).toBeGreaterThan(0);
  });

  it("never lets glass exceed the wall it sits in", () => {
    const m = makeMass({ w: 40, d: 30, floors: 1, fth: 10, glz: "full", cov: 100 });
    const env = envelopeTakeoff(m);
    expect(env.glass).toBeLessThanOrEqual(env.grossWall + 1e-9);
    expect(env.opaque).toBeGreaterThanOrEqual(0);
  });

  it("adds gable end wall and slope to a pitched roof", () => {
    const flat = envelopeTakeoff(makeMass({ w: 100, d: 40, roof: "flat" }));
    const gable = envelopeTakeoff(makeMass({ w: 100, d: 40, roof: "gable", pitch: 6, ridge: "w" }));
    expect(gable.grossWall).toBeGreaterThan(flat.grossWall);
    expect(gable.roofPitched).toBeGreaterThan(100 * 40);
    expect(gable.roofFlat).toBe(0);
  });

  it("only excavates when below grade is switched on", () => {
    const base = { w: 100, d: 60, floors: 2, gradeRef: 12, baseElev: 0 } as const;
    expect(belowGradeTakeoff(makeMass({ ...base, belowGrade: false })).excavationCY).toBe(0);
    expect(belowGradeTakeoff(makeMass({ ...base, belowGrade: true })).excavationCY).toBeGreaterThan(0);
  });

  it("reports facade orientation from the mass rotation", () => {
    expect(facadeCardinal("f", 0)).toBe("N");
    expect(facadeCardinal("r", 0)).toBe("E");
    expect(facadeCardinal("f", 90)).toBe("E");
  });
});

describe("program seeding", () => {
  it("distributes a capacity target to whole units that sum exactly", () => {
    const seeded = seedProgramForType("mf_wrap", 240);
    const countable = ["apt_studio", "apt_1br", "apt_2br", "apt_3br"];
    const total = countable.reduce((a, ref) => a + (seeded.program[ref] ?? 0), 0);
    expect(total).toBe(240);
    expect(seeded.capacityUnits).toBe(240);
  });

  it("seeds every building type without error", () => {
    for (const t of BUILDING_TYPES) {
      const seeded = seedProgramForType(t.id, 50);
      expect(seeded.netArea).toBeGreaterThan(0);
    }
  });

  it("adds support space off the type ratios", () => {
    const seeded = seedProgramForType("sl_il", 100);
    expect(seeded.support.amen_dining).toBeGreaterThan(0);
    expect(seeded.program.amen_dining).toBe(seeded.support.amen_dining);
  });
});

describe("capacity check", () => {
  it("flags a box too small for its program", () => {
    const program = seedProgramForType("mf_wrap", 200).program;
    const tight = makeMass({ w: 100, d: 60, floors: 2, typeId: "mf_wrap", program });
    expect(capacity(tight).over).toBe(true);
  });

  it("fits a footprint that actually holds the program", () => {
    const seeded = seedProgramForType("mf_wrap", 200);
    const floors = 5;
    // Size and shape must be decided together: a box sized for a U-plan and
    // then built as a rectangle is oversized, and the reverse cannot hold its
    // program. makeMassForType applies the same shape fitFootprint sized for.
    const { w, d } = fitFootprint(seeded.netArea, "mf_wrap", floors);
    const sized = makeMassForType("mf_wrap", { w, d, floors, program: seeded.program });
    const c = capacity(sized);
    // Sized for the grossed program; the core pushes it a little over, which is
    // exactly the nudge the user is meant to see and resolve.
    expect(c.pct).toBeGreaterThan(95);
    expect(c.pct).toBeLessThan(115);
    expect(netProgramArea(sized)).toBeCloseTo(seeded.netArea, 5);
  });

  it("requires at least two stairs and scales elevators with floors", () => {
    const m = makeMass({ w: 300, d: 66, floors: 6, typeId: "mf_wrap", program: { apt_1br: 120 } });
    const c = circulation(m);
    expect(c.stairs).toBeGreaterThanOrEqual(2);
    expect(c.elevators).toBeGreaterThanOrEqual(2);
    expect(c.coreSF).toBeGreaterThan(0);
  });
});

describe("estimate", () => {
  const scheme = () => {
    const seeded = seedProgramForType("mf_wrap", 200);
    const floors = 5;
    const { w, d } = fitFootprint(seeded.netArea, "mf_wrap", floors);
    return [makeMassForType("mf_wrap", { w, d, floors, program: seeded.program })];
  };

  it("prices every quantity the takeoff produces", async () => {
    const t = takeoff(scheme());
    const est = await estimateScheme(t, resolver(), { marketId: "multifamily", typeId: "mf_wrap" });
    expect(est.bottomUp.unpriced).toEqual([]);
    expect(est.bottomUp.total).toBeGreaterThan(0);
  });

  it("lands in a believable $/GSF range for the type", async () => {
    const t = takeoff(scheme());
    const est = await estimateScheme(t, resolver(), { marketId: "multifamily", typeId: "mf_wrap" });
    expect(est.bottomUp.perGSF).toBeGreaterThan(120);
    expect(est.bottomUp.perGSF).toBeLessThan(600);
  });

  it("reconciles bottom-up against the conceptual band", async () => {
    const t = takeoff(scheme());
    const est = await estimateScheme(t, resolver(), { marketId: "multifamily", typeId: "mf_wrap" });
    expect(est.conceptual).not.toBeNull();
    expect(est.reconciliation).not.toBeNull();
    expect(["within band", "below band", "above band"]).toContain(est.reconciliation!.verdict);
  });

  it("rolls lines into UNIFORMAT divisions that sum to direct cost", async () => {
    const t = takeoff(scheme());
    const est = await estimateScheme(t, resolver(), { marketId: "multifamily", typeId: "mf_wrap" });
    const summed = est.bottomUp.divisions.reduce((a, d) => a + d.amount, 0);
    expect(summed).toBeCloseTo(est.bottomUp.direct, 2);
    expect(est.bottomUp.divisions.map((d) => d.id)).toContain("shell");
  });

  it("scales with the location index", async () => {
    const t = takeoff(scheme());
    const r = resolver();
    const base = await estimateScheme(t, r, { marketId: "multifamily", adjustment: { locationIndex: 100, escalationPctPerYear: 0 } });
    const philly = await estimateScheme(t, r, { marketId: "multifamily", adjustment: { locationIndex: 115, escalationPctPerYear: 0 } });
    expect(philly.bottomUp.direct / base.bottomUp.direct).toBeCloseTo(1.15, 3);
  });

  it("carries provenance onto every line and reports the source mix", async () => {
    const t = takeoff(scheme());
    const est = await estimateScheme(t, resolver(), { marketId: "multifamily" });
    expect(est.bottomUp.lines.every((l) => Boolean(l.provenance.sourceId))).toBe(true);
    expect(est.bottomUp.sourceMix[0].sourceLabel).toContain("seed");
    expect(est.bottomUp.weakestConfidence).toBe("low");
  });

  it("shows an override on the line and keeps the value it replaced", async () => {
    const overrides = new OverrideCostSource();
    overrides.set("wall_fiber_cement", 99, "SF", { note: "Quoted" });
    const r = new CostResolver().register(new SeedCostSource()).register(overrides);

    const t = takeoff(scheme());
    const est = await estimateScheme(t, r, { marketId: "multifamily" });
    const line = est.bottomUp.lines.find((l) => l.key === "wall_fiber_cement")!;
    expect(line.baseRate).toBe(99);
    expect(line.provenance.sourceKind).toBe("override");
    expect(line.superseded[0].sourceLabel).toContain("seed");
  });

  it("reports unpriced quantities rather than dropping them", () => {
    const t = takeoff(scheme());
    t.quantities.unobtanium_cladding = 500;
    const est = priceBottomUp(t, new Map());
    expect(est.unpriced.some((u) => u.key === "unobtanium_cladding")).toBe(true);
    expect(est.total).toBe(0);
  });

  it("calls out a bottom-up number outside the published band", () => {
    const conceptual = {
      low: 100, likely: 120, high: 140,
      benchmark: { scope: "construction" },
    } as any;
    const rec = reconcile({ direct: 150, construction: 200, project: 240 } as any, conceptual);
    expect(rec.scope).toBe("construction");
    expect(rec.bottomUp).toBe(200);
    expect(rec.withinBand).toBe(false);
    expect(rec.verdict).toBe("above band");
    expect(rec.variancePct).toBeCloseTo(66.67, 1);
  });
});
