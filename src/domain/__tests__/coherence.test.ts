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
const SCENARIOS: Record<string, { target: number; floors: number }> = {
  sl_il: { target: 120, floors: 4 }, sl_al: { target: 80, floors: 3 },
  sl_mc: { target: 40, floors: 1 }, sl_snf: { target: 90, floors: 2 },
  sl_ccrc: { target: 220, floors: 4 }, sl_affordable: { target: 80, floors: 4 },
  hc_mob: { target: 60_000, floors: 3 }, hc_asc: { target: 4, floors: 1 },
  hc_clinic: { target: 20, floors: 1 }, hc_bedtower: { target: 120, floors: 6 },
  hc_ed: { target: 24, floors: 1 }, hc_imaging: { target: 4, floors: 1 },
  hc_behavioral: { target: 48, floors: 2 },
  he_residence: { target: 400, floors: 5 }, he_academic: { target: 60_000, floors: 3 },
  he_lab: { target: 80_000, floors: 3 }, he_student_life: { target: 50_000, floors: 2 },
  he_athletics: { target: 90_000, floors: 2 }, he_library: { target: 70_000, floors: 3 },
  mf_garden: { target: 100, floors: 3 }, mf_wrap: { target: 200, floors: 5 },
  mf_podium: { target: 180, floors: 6 }, mf_highrise: { target: 250, floors: 18 },
  mf_affordable: { target: 90, floors: 4 }, mf_townhome: { target: 40, floors: 3 },
  hp_select: { target: 120, floors: 5 }, hp_extended: { target: 110, floors: 4 },
  hp_full: { target: 250, floors: 8 }, hp_boutique: { target: 90, floors: 6 },
  wk_shell: { target: 90_000, floors: 4 }, wk_fitout: { target: 30_000, floors: 1 },
  wk_flex: { target: 60_000, floors: 1 },
  in_warehouse: { target: 250_000, floors: 1 }, in_manufacturing: { target: 120_000, floors: 1 },
  in_cold: { target: 150_000, floors: 1 },
  cv_k12: { target: 900, floors: 2 }, cv_worship: { target: 700, floors: 1 },
  cv_municipal: { target: 30_000, floors: 2 }, cv_recreation: { target: 60_000, floors: 1 },
  pk_garage: { target: 400, floors: 5 }, pk_below: { target: 200, floors: 2 },
  pk_surface: { target: 300, floors: 1 },
};

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
      // Both readings are independent, so agreement inside 30% is the signal
      // that neither has drifted. Tighter than that would be tuning to the test.
      expect(Math.abs(rec.variancePct), `${typeId} variance ${rec.variancePct.toFixed(0)}%`).toBeLessThan(30);
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
    // Construction excludes design fees, so it must sit below the project total.
    expect(est.bottomUp.construction).toBeLessThan(est.bottomUp.project);
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
