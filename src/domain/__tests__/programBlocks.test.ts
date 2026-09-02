/**
 * Programmes inside one building.
 *
 * The request this covers is specific: put an ambulatory surgery centre inside
 * a medical office building, and also price one on its own. Those are two
 * different arithmetics living in the same scheme, and three things have to
 * hold for the answer to mean anything:
 *
 *   the areas add up,
 *   the box grows to hold them,
 *   and the money moves.
 *
 * The last one is the trap. A programme that changes the panel and not the
 * estimate is this project's signature defect: priced but not drawn, or here,
 * drawn but not priced.
 */

import { describe, expect, it } from "vitest";
import { blockFromChain, resolveBlocks, resolveChain } from "../drivers";
import { capacity, fitFootprintToGross, fitFootprint, grossingFactor } from "../program";
import { makeMassForType, grossArea } from "../massing";
import { takeoff } from "../takeoff";
import { estimateScheme } from "../estimate";
import { CostResolver } from "@/costs/resolver";
import { SeedCostSource } from "@/costs/sources/seedSource";
import { blendRates, describeMix, normalizeMix } from "@/costs/blend";
import { TYPE_BY_ID } from "@/markets/registry";

const MOB = TYPE_BY_ID["hc_mob"];
const ASC = TYPE_BY_ID["hc_asc"];
const resolver = new CostResolver().register(new SeedCostSource());

const mobBlock = () => blockFromChain("pb1", MOB.label, MOB.driverChain!, "hc_mob");
const ascBlock = () => blockFromChain("pb2", ASC.label, ASC.driverChain!, "hc_asc");

describe("a surgery centre added to a medical office building", () => {
  it("adds its area rather than replacing it", () => {
    const alone = resolveBlocks([mobBlock()]);
    const both = resolveBlocks([mobBlock(), ascBlock()]);
    expect(both.bgsf).toBeCloseTo(alone.bgsf + resolveChain(ASC.driverChain!).bgsf, 6);
    expect(both.blocks).toHaveLength(2);
  });

  it("states each programme's share of the building", () => {
    const both = resolveBlocks([mobBlock(), ascBlock()]);
    const shares = both.blocks.map((b) => b.shareOfBgsf);
    expect(shares.reduce((a, s) => a + s, 0)).toBeCloseTo(1, 9);
    // The office side is the larger of the two at seeded counts.
    expect(shares[0]).toBeGreaterThan(shares[1]);
  });

  it("reads circulation once for the building, not once per programme", () => {
    const both = resolveBlocks([mobBlock(), ascBlock()]);
    const circ = both.categories.filter((c) => c.label.toLowerCase() === "circulation");
    expect(circ).toHaveLength(1);
    // Both chains carry a circulation balance, so the merged one is their sum.
    const each = [MOB.driverChain!, ASC.driverChain!].map(
      (c) => resolveChain(c).categories.find((x) => x.label.toLowerCase() === "circulation")!.area,
    );
    expect(circ[0].area).toBeCloseTo(each[0] + each[1], 6);
  });

  it("restates every category against the combined building", () => {
    const both = resolveBlocks([mobBlock(), ascBlock()]);
    const total = both.categories.reduce((a, c) => a + c.share, 0);
    expect(total).toBeCloseTo(1, 6);
    for (const c of both.categories) expect(c.area).toBeCloseTo(both.bgsf * c.share, 4);
  });

  it("keeps each programme's own chain editable without touching the other", () => {
    const blocks = [mobBlock(), ascBlock()];
    const before = resolveBlocks(blocks);
    // Double the ORs on the surgery side only.
    const edited = blocks.map((b) =>
      b.id !== "pb2"
        ? b
        : { ...b, chain: { ...b.chain, drivers: b.chain.drivers.map((d) => ({ ...d, count: d.count * 2 })) } },
    );
    const after = resolveBlocks(edited);
    expect(after.blocks[0].bgsf).toBeCloseTo(before.blocks[0].bgsf, 6);
    expect(after.blocks[1].bgsf).toBeCloseTo(before.blocks[1].bgsf * 2, 6);
  });

  it("survives a chain seeded from a type without aliasing it", () => {
    const block = ascBlock();
    block.chain.drivers[0].count = 99;
    expect(ASC.driverChain!.drivers[0].count).not.toBe(99);
  });
});

describe("fitting the box to the programme", () => {
  it("targets building gross without grossing it a second time", () => {
    const bgsf = resolveBlocks([mobBlock(), ascBlock()]).bgsf;
    const { w, d } = fitFootprintToGross(bgsf, "hc_mob", 3, 2.6);
    const mass = makeMassForType("hc_mob", { w, d, floors: 3, program: {} });
    // Within a rounding of the footprint dimensions, the box holds the ask.
    expect(Math.abs(grossArea(mass) - bgsf) / bgsf).toBeLessThan(0.02);
  });

  it("is exactly the net fitter with the type's grossing already applied", () => {
    const net = 40_000;
    const g = MOB.defaults.grossing;
    expect(fitFootprintToGross(net * g, "hc_mob", 3)).toEqual(fitFootprint(net, "hc_mob", 3));
  });

  it("grows the box when the surgery centre is added", () => {
    const floors = 3;
    const office = fitFootprintToGross(resolveBlocks([mobBlock()]).bgsf, "hc_mob", floors);
    const both = fitFootprintToGross(resolveBlocks([mobBlock(), ascBlock()]).bgsf, "hc_mob", floors);
    expect(both.w * both.d).toBeGreaterThan(office.w * office.d);
  });
});

describe("the cost mix", () => {
  it("folds repeat types together and normalizes to one", () => {
    const mix = normalizeMix([
      { typeId: "hc_mob", label: "MOB", share: 2 },
      { typeId: "hc_mob", label: "MOB", share: 1 },
      { typeId: "hc_asc", label: "ASC", share: 1 },
    ]);
    expect(mix).toHaveLength(2);
    expect(mix[0]).toMatchObject({ typeId: "hc_mob", share: 0.75 });
    expect(mix[1].share).toBeCloseTo(0.25, 9);
  });

  it("drops empty programmes rather than dividing by them", () => {
    expect(normalizeMix([{ typeId: "hc_mob", label: "MOB", share: 0 }])).toEqual([]);
  });

  it("blends a rate strictly between the two types it came from", async () => {
    const mob = await resolver.rates(["hvac"], { typeId: "hc_mob" });
    const asc = await resolver.rates(["hvac"], { typeId: "hc_asc" });
    const lo = mob.get("hvac")!.line.likely;
    const hi = asc.get("hvac")!.line.likely;
    expect(hi).toBeGreaterThan(lo);

    const blend = blendRates([
      { entry: { typeId: "hc_mob", label: "MOB", share: 0.7 }, rates: mob },
      { entry: { typeId: "hc_asc", label: "ASC", share: 0.3 }, rates: asc },
    ]);
    expect(blend.get("hvac")!.line.likely).toBeCloseTo(0.7 * lo + 0.3 * hi, 6);
  });

  it("marks the blend derived and names the mix, so it cannot pass as published", async () => {
    const blend = blendRates([
      { entry: { typeId: "hc_mob", label: "Medical office building", share: 0.7 },
        rates: await resolver.rates(["hvac"], { typeId: "hc_mob" }) },
      { entry: { typeId: "hc_asc", label: "Ambulatory Surgery Center", share: 0.3 },
        rates: await resolver.rates(["hvac"], { typeId: "hc_asc" }) },
    ]);
    const prov = blend.get("hvac")!.line.provenance;
    expect(prov.derived).toBe(true);
    expect(prov.note).toContain("70% Medical office building");
    expect(prov.note).toContain("30% Ambulatory Surgery Center");
    // A blended rate belongs to no single type.
    expect(blend.get("hvac")!.line.typeId).toBeUndefined();
  });

  it("passes a single full-weight programme through untouched", async () => {
    const mob = await resolver.rates(["hvac"], { typeId: "hc_mob" });
    const blend = blendRates([{ entry: { typeId: "hc_mob", label: "MOB", share: 1 }, rates: mob }]);
    expect(blend.get("hvac")).toBe(mob.get("hvac"));
  });

  it("describes itself in whole percents", () => {
    expect(describeMix([
      { typeId: "a", label: "Office", share: 0.68 },
      { typeId: "b", label: "Surgery", share: 0.32 },
    ])).toBe("68% Office, 32% Surgery");
  });
});

describe("the money actually moves", () => {
  /**
   * The whole point. Two identical buildings, same box and same quantities;
   * one is all medical office, the other is a third surgery centre. If the
   * estimate does not separate them, the surgery centre was never priced.
   */
  async function priceMix(mix: { typeId: string; label: string; share: number }[]) {
    const { w, d } = fitFootprintToGross(90_000, "hc_mob", 3);
    const t = takeoff([makeMassForType("hc_mob", { w, d, floors: 3, program: {} })]);
    return estimateScheme(t, resolver, { marketId: "healthcare", typeId: "hc_mob", mix });
  }

  it("prices a mixed building above the same box as pure medical office", async () => {
    const office = await priceMix([{ typeId: "hc_mob", label: "MOB", share: 1 }]);
    const mixed = await priceMix([
      { typeId: "hc_mob", label: "MOB", share: 0.7 },
      { typeId: "hc_asc", label: "ASC", share: 0.3 },
    ]);
    expect(mixed.bottomUp.construction).toBeGreaterThan(office.bottomUp.construction * 1.02);
  });

  it("lands between the two pure readings, never outside them", async () => {
    const office = await priceMix([{ typeId: "hc_mob", label: "MOB", share: 1 }]);
    const surgery = await priceMix([{ typeId: "hc_asc", label: "ASC", share: 1 }]);
    const mixed = await priceMix([
      { typeId: "hc_mob", label: "MOB", share: 0.7 },
      { typeId: "hc_asc", label: "ASC", share: 0.3 },
    ]);
    expect(mixed.bottomUp.construction).toBeGreaterThan(office.bottomUp.construction);
    expect(mixed.bottomUp.construction).toBeLessThan(surgery.bottomUp.construction);
  });

  it("checks the mixed building against a blended band, not one type's", async () => {
    const mixed = await priceMix([
      { typeId: "hc_mob", label: "Medical office building", share: 0.7 },
      { typeId: "hc_asc", label: "Ambulatory Surgery Center", share: 0.3 },
    ]);
    expect(mixed.conceptual).not.toBeNull();
    expect(mixed.conceptual!.benchmark.label).toContain("70% Medical office building");
    expect(mixed.conceptual!.benchmark.provenance.derived).toBe(true);

    const office = await priceMix([{ typeId: "hc_mob", label: "MOB", share: 1 }]);
    const surgery = await priceMix([{ typeId: "hc_asc", label: "ASC", share: 1 }]);
    const band = (e: typeof mixed) => e.conceptual!.benchmark.likely;
    expect(band(mixed)).toBeGreaterThan(band(office));
    expect(band(mixed)).toBeLessThan(band(surgery));
  });

  it("still reconciles: a mixed building is not a broken one", async () => {
    const mixed = await priceMix([
      { typeId: "hc_mob", label: "MOB", share: 0.7 },
      { typeId: "hc_asc", label: "ASC", share: 0.3 },
    ]);
    expect(mixed.reconciliation).not.toBeNull();
    expect(Math.abs(mixed.reconciliation!.variancePct)).toBeLessThan(33);
    expect(mixed.bottomUp.unpriced).toEqual([]);
  });

  it("ignores a mix of one, leaving single-type schemes exactly as they were", async () => {
    const { w, d } = fitFootprintToGross(90_000, "hc_mob", 3);
    const t = takeoff([makeMassForType("hc_mob", { w, d, floors: 3, program: {} })]);
    const plain = await estimateScheme(t, resolver, { marketId: "healthcare", typeId: "hc_mob" });
    const withMix = await estimateScheme(t, resolver, {
      marketId: "healthcare",
      typeId: "hc_mob",
      mix: [{ typeId: "hc_mob", label: "MOB", share: 1 }],
    });
    expect(withMix.bottomUp.construction).toBeCloseTo(plain.bottomUp.construction, 6);
  });
});

describe("a surgery centre priced on its own", () => {
  it("is a building type in its own right, driven by operating rooms", async () => {
    const bgsf = resolveChain(ASC.driverChain!).bgsf;
    const { w, d } = fitFootprintToGross(bgsf, "hc_asc", 1);
    const t = takeoff([makeMassForType("hc_asc", { w, d, floors: 1, program: {} })]);
    const est = await estimateScheme(t, resolver, { marketId: "healthcare", typeId: "hc_asc" });
    expect(est.conceptual).not.toBeNull();
    expect(est.bottomUp.unpriced).toEqual([]);
    expect(est.bottomUp.construction).toBeGreaterThan(0);
    // Four ORs at the seeded chain is a small building, and it should read as one.
    expect(bgsf).toBeGreaterThan(10_000);
    expect(bgsf).toBeLessThan(30_000);
  });
});

describe("the grossing factor is the estimator's to set", () => {
  /**
   * Net-to-gross is the single assumption most likely to be argued in a
   * conceptual review, and until now it was only readable. A type default is a
   * starting point, not a rule: a courtyard plan or a client with an unusual
   * circulation standard will not honour it, and the person holding the
   * estimate has to be able to say so.
   */
  const seeded = (grossing: number | null) => ({
    ...makeMassForType("hc_mob", { w: 200, d: 90, floors: 3, program: { exam_op: 60 } }),
    grossing,
  });

  it("falls back to the type's own factor when unset", () => {
    expect(grossingFactor(seeded(null))).toBeCloseTo(MOB.defaults.grossing, 9);
  });

  it("takes the override when one is set", () => {
    expect(grossingFactor(seeded(1.75))).toBeCloseTo(1.75, 9);
  });

  it("never grosses below net, whatever is typed in", () => {
    expect(grossingFactor(seeded(0.4))).toBe(1);
    expect(grossingFactor(seeded(-3))).toBe(1);
  });

  it("moves the program the box has to hold, not just the readout", () => {
    const tight = capacity(seeded(1.3));
    const loose = capacity(seeded(1.8));
    expect(loose.required).toBeGreaterThan(tight.required);
    // Core area is counted once outside the grossing, so the difference is
    // exactly the net program times the change in factor.
    expect(loose.required - tight.required).toBeCloseTo(tight.netProgram * 0.5, 6);
    expect(loose.available).toBeCloseTo(tight.available, 9);
  });
});
