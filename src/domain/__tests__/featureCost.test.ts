import { describe, expect, it } from "vitest";
import { CostResolver } from "@/costs/resolver";
import { SeedCostSource } from "@/costs/sources/seedSource";
import { makeMassForType, type Mass } from "../massing";
import { makeFeature } from "../features";
import { priceFeatures, totalFeatureCost } from "../featureCost";

const resolver = () => new CostResolver().register(new SeedCostSource());

/**
 * Neutralise everything the type seeds so a test measures the feature under
 * test rather than the type's default kit. This has broken three times before
 * by types starting to seed a new property; keep it explicit.
 */
const baseMass = (over: Partial<Mass> = {}): Mass =>
  makeMassForType("hc_mob", {
    w: 180,
    d: 100,
    floors: 3,
    program: { exam_op: 60 },
    shape: { kind: "rect" },
    features: [],
    stepbacks: [],
    skinBands: [],
    roofAssembly: "membrane",
    parapet: 3.5,
    ...over,
  });

describe("feature pricing", () => {
  it("prices nothing when there are no features", async () => {
    const costs = await priceFeatures(baseMass(), resolver());
    expect(costs).toEqual([]);
    expect(totalFeatureCost(costs)).toBe(0);
  });

  it("prices a canopy and reports it against the feature's own id", async () => {
    const canopy = makeFeature("canopy");
    const costs = await priceFeatures(baseMass({ features: [canopy] }), resolver());
    expect(costs).toHaveLength(1);
    expect(costs[0].featureId).toBe(canopy.id);
    expect(costs[0].amount).toBeGreaterThan(0);
    expect(costs[0].lines.length).toBeGreaterThan(0);
    expect(costs[0].unpriced).toEqual([]);
  });

  it("orders lines by amount so the driver is first", async () => {
    const costs = await priceFeatures(
      baseMass({ features: [makeFeature("lobby")] }),
      resolver(),
    );
    const amounts = costs[0].lines.map((l) => l.amount);
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });

  it("charges a disabled feature nothing", async () => {
    const on = makeFeature("canopy");
    const off = makeFeature("canopy", { disabled: true });
    const [a, b] = await priceFeatures(baseMass({ features: [on, off] }), resolver());
    expect(a.amount).toBeGreaterThan(0);
    expect(b.amount).toBe(0);
    expect(b.lines).toEqual([]);
  });

  it("scales with the parameter that drives the quantity", async () => {
    const small = makeFeature("canopy", { projection: 6, width: 20 });
    const large = makeFeature("canopy", { projection: 12, width: 40 });
    const [s] = await priceFeatures(baseMass({ features: [small] }), resolver());
    const [l] = await priceFeatures(baseMass({ features: [large] }), resolver());
    expect(l.amount).toBeGreaterThan(s.amount * 2);
  });

  it("reports envelope side effects separately rather than in the amount", async () => {
    const bay = makeFeature("bay");
    const [cost] = await priceFeatures(baseMass({ features: [bay] }), resolver());
    expect(cost.envelopeEffect.wall).toBeGreaterThan(0);
    // The wall a bay adds is priced in the shell divisions, so the feature's
    // own amount must not silently contain it.
    for (const line of cost.lines) expect(line.key).not.toMatch(/^wall_/);
  });

  it("reports a plate a feature removes as a negative", async () => {
    const [cost] = await priceFeatures(
      baseMass({ features: [makeFeature("atrium")] }),
      resolver(),
    );
    expect(cost.envelopeEffect.plate).toBeLessThan(0);
  });

  it("prices every feature kind the editor can add", async () => {
    const kinds = [
      "canopy", "porte_cochere", "bay", "lobby", "sunshade", "brise_soleil",
      "balcony", "loggia", "feature_corner", "atrium", "connector", "terrace",
      "plaza", "pergola", "roof_screen", "cornice",
    ] as const;
    for (const kind of kinds) {
      const [cost] = await priceFeatures(
        baseMass({ features: [makeFeature(kind)] }),
        resolver(),
      );
      expect(cost.unpriced, `${kind} has unpriced keys`).toEqual([]);
      expect(cost.amount, `${kind} priced at zero`).toBeGreaterThan(0);
    }
  });

  it("totals only what it is handed", async () => {
    const costs = await priceFeatures(
      baseMass({ features: [makeFeature("canopy"), makeFeature("plaza")] }),
      resolver(),
    );
    expect(totalFeatureCost(costs)).toBeCloseTo(costs[0].amount + costs[1].amount, 6);
  });
});
