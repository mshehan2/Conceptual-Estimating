/**
 * Whole-model coherence.
 *
 * The two halves of the estimate are computed from completely different data —
 * a geometric takeoff priced by assembly rates, versus a published $/GSF
 * benchmark for the market and type. There is no shared term between them, so
 * if they agree it is because both are roughly right.
 *
 * This test seeds a realistic scheme for every building type in the registry
 * and asserts the two readings land within a tolerance of each other. It is the
 * canary for a bad rate, a mis-scaled profile, or a capacity unit read wrong:
 * seeding 900 students as 900 classrooms shows up here immediately.
 */

import { describe, expect, it } from "vitest";
import { CostResolver } from "@/costs/resolver";
import { SeedCostSource } from "@/costs/sources/seedSource";
import { makeMassForType } from "../massing";
import { fitFootprint, seedProgramForType } from "../program";
import { takeoff } from "../takeoff";
import { estimateScheme } from "../estimate";
import { BUILDING_TYPES, TYPE_BY_ID } from "@/markets/registry";

/** A plausible project size and height for each type. */
import { SCENARIOS } from "./coherenceScenarios";


const resolver = new CostResolver().register(new SeedCostSource());

async function priceType(typeId: string) {
  const type = TYPE_BY_ID[typeId];
  const { target, floors } = SCENARIOS[typeId];
  const seeded = seedProgramForType(typeId, target);
  const { w, d } = fitFootprint(seeded.netArea, typeId, floors);
  const t = takeoff([makeMassForType(typeId, { w, d, floors, program: seeded.program })]);
  const est = await estimateScheme(t, resolver, { marketId: type.marketId, typeId });
  return { type, takeoff: t, est };
}

describe("model coherence across every building type", () => {
  it("has a scenario for every registered type", () => {
    const missing = BUILDING_TYPES.filter((t) => !SCENARIOS[t.id]).map((t) => t.id);
    expect(missing).toEqual([]);
  });

  it.each(BUILDING_TYPES.map((t) => [t.id, t.label] as const))(
    "%s (%s) reconciles bottom-up against the conceptual band",
    async (typeId) => {
      const { est } = await priceType(typeId);
      expect(est.conceptual, "no conceptual benchmark").not.toBeNull();
      expect(est.reconciliation).not.toBeNull();

      const rec = est.reconciliation!;
      // Both readings are independent, so agreement inside this band is the
      // signal that neither has drifted. Tighter would be tuning to the test.
      //
      // The binding case is wk_fitout at 31%, and it is not a defect: its
      // bottom-up sits INSIDE the $110-200 band at $196, just well above the
      // $150 likely, because the seeded mix of open office, private office and
      // seminar rooms with full allowances describes a well-appointed tenant
      // improvement rather than a median one. Nothing is double counted; its
      // scopeMode is interiors and Shell reads $0.9/SF.
      //
      // 35% briefly, when the markup cascade was corrected to compound and
      // in_cold read 32%. in_cold was a real double count and is fixed, so
      // this comes back down.
      expect(Math.abs(rec.variancePct), `${typeId} variance ${rec.variancePct.toFixed(0)}%`).toBeLessThan(33);
    },
  );

  it.each(BUILDING_TYPES.map((t) => [t.id] as const))("%s prices every quantity it produces", async (typeId) => {
    const { est } = await priceType(typeId);
    expect(est.bottomUp.unpriced).toEqual([]);
  });

  it("compares at the benchmark's own scope, not the all-in total", async () => {
    const { est } = await priceType("mf_wrap");
    expect(est.conceptual!.benchmark.scope).toBe("construction");
    expect(est.reconciliation!.scope).toBe("construction");
    // Construction never exceeds the project total. It only sits strictly
    // below it when a project-scope markup is carried, and Benchmark's own
    // cascade carries none: their Project Total is construction plus
    // escalation, with no A/E fee in it. So equality here is correct, not a
    // missing step.
    expect(est.bottomUp.construction).toBeLessThanOrEqual(est.bottomUp.project);
    expect(est.reconciliation!.bottomUp).toBe(est.bottomUp.construction);
  });

  it("gives a tenant fit-out no substructure or envelope", async () => {
    const { est } = await priceType("wk_fitout");
    const keys = est.bottomUp.lines.map((l) => l.key);
    expect(keys).not.toContain("spread_found");
    expect(keys).not.toContain("elevated_floor");
    expect(keys.some((k) => k.startsWith("wall_"))).toBe(false);
  });

  it("gives a parking deck no interior fit-out", async () => {
    const { est } = await priceType("pk_garage");
    expect(est.bottomUp.lines.some((l) => l.key.startsWith("fitout_"))).toBe(false);
    expect(est.bottomUp.lines.some((l) => l.key === "elevated_floor")).toBe(true);
  });

  it("prices an operating room's air handling far above an apartment's", async () => {
    const apartment = await resolver.rates(["hvac"], { typeId: "mf_wrap" });
    const acute = await resolver.rates(["hvac"], { typeId: "hc_bedtower" });
    expect(acute.get("hvac")!.line.likely).toBeGreaterThan(apartment.get("hvac")!.line.likely * 2);
  });

  it("carries medical gas in a hospital and none in a warehouse", async () => {
    const hospital = await resolver.rates(["allow_medgas"], { typeId: "hc_bedtower" });
    const warehouse = await resolver.rates(["allow_medgas"], { typeId: "in_warehouse" });
    expect(hospital.get("allow_medgas")!.line.likely).toBeGreaterThan(0);
    expect(warehouse.get("allow_medgas")!.line.likely).toBe(0);
  });
});

describe("cold storage prices its envelope once", () => {
  /**
   * The freezer and cooler rates used to be labelled "envelope & refrigeration"
   * while the mass separately priced an insulated metal panel skin as its
   * shell. On a 380x260x40 box that skin is $21.8 per SF of floor, and it was
   * being paid for twice. Bottom-up read $375/SF construction against a band
   * whose high was $350: above the range the benchmark says is possible.
   */
  it("keeps the insulated skin out of the freezer fit-out rate", async () => {
    const { est, takeoff: t } = await priceType("in_cold");
    const rec = est.reconciliation!;
    // Inside the band, not merely close to it.
    expect(est.bottomUp.construction / t.gsf).toBeLessThan(rec.conceptualHigh / t.gsf);
    expect(Math.abs(rec.variancePct)).toBeLessThan(25);
  });

  it("still carries a real insulated envelope in the shell", async () => {
    // The correction must not have deleted the envelope, only stopped charging
    // for it twice.
    const { est } = await priceType("in_cold");
    const shell = est.bottomUp.divisions.find((d) => d.label === "Shell");
    expect(shell!.amount).toBeGreaterThan(0);
  });
});
