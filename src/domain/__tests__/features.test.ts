/**
 * Features and shape must move the number.
 *
 * The claim this whole direction rests on is that a design decision you can see
 * is a design decision you are paying for. These tests are that claim, written
 * down: add a canopy and the estimate rises by roughly a canopy; cut a
 * courtyard and the envelope grows while the area shrinks; step the top floor
 * back and the upper plates get smaller.
 *
 * If any of these stop holding, the renders and the estimate have drifted apart
 * and the tool is lying.
 */

import { describe, expect, it } from "vitest";
import { CostResolver } from "@/costs/resolver";
import { SeedCostSource } from "@/costs/sources/seedSource";
import { makeMassForType, envelopeTakeoff, footprint, grossArea, roofPlates, floorPlates } from "../massing";
import { takeoff } from "../takeoff";
import { estimateScheme } from "../estimate";
import { makeFeature, resetFeatureSeq } from "../features";
import type { Mass } from "../massing";

const resolver = new CostResolver().register(new SeedCostSource());

/**
 * A deliberately plain mass: rectangular, no features.
 *
 * The building type seeds its own plan shape and characteristic features, which
 * is right for the product and wrong for a test measuring one variable. Every
 * case here starts from a controlled baseline and adds exactly the thing under
 * test.
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
    ...over,
  });

const priceOf = async (m: Mass) => {
  const est = await estimateScheme(takeoff([m]), resolver, { marketId: "healthcare", typeId: "hc_mob" });
  return est.bottomUp;
};

describe("features change the estimate", () => {
  it("adds a canopy as its own priced line", async () => {
    resetFeatureSeq();
    const plain = await priceOf(baseMass());
    const withCanopy = await priceOf(
      baseMass({ features: [makeFeature("canopy", { width: 30, projection: 10, support: "cantilever" })] }),
    );

    const line = withCanopy.lines.find((l) => l.key === "canopy_cantilever");
    expect(line, "canopy should appear as a line item").toBeDefined();
    expect(line!.quantity).toBeCloseTo(300, 4);
    expect(withCanopy.direct).toBeGreaterThan(plain.direct);
  });

  it("prices a column-supported canopy above a cantilevered one of the same size", async () => {
    const size = { width: 30, projection: 10 };
    const cantilever = await priceOf(baseMass({ features: [makeFeature("canopy", { ...size, support: "cantilever" })] }));
    const supported = await priceOf(baseMass({ features: [makeFeature("canopy", { ...size, support: "column" })] }));
    // The canopy itself is cheaper supported, but the columns more than
    // account for the difference.
    expect(supported.direct).toBeGreaterThan(cantilever.direct);
    expect(supported.lines.some((l) => l.key === "canopy_column")).toBe(true);
  });

  it("prices a porte cochere well above a plain canopy", async () => {
    const canopy = await priceOf(baseMass({ features: [makeFeature("canopy", { width: 40, projection: 24 })] }));
    const porte = await priceOf(baseMass({ features: [makeFeature("porte_cochere", { width: 40, projection: 24 })] }));
    expect(porte.direct).toBeGreaterThan(canopy.direct);
  });

  it("turns a lobby volume into storefront rather than free glass", async () => {
    const withLobby = await priceOf(baseMass({ features: [makeFeature("lobby", { width: 40, floors: 2 })] }));
    const storefront = withLobby.lines.find((l) => l.key === "storefront");
    expect(storefront).toBeDefined();
    expect(storefront!.quantity).toBeGreaterThan(0);
    expect(storefront!.amount).toBeGreaterThan(0);
  });

  it("makes a bay add envelope on three sides", () => {
    const plain = envelopeTakeoff(baseMass());
    const bayed = envelopeTakeoff(
      baseMass({ features: [makeFeature("bay", { width: 16, projection: 4, fromFloor: 0, toFloor: 2 })] }),
    );
    // Two returns of 4ft over the full height, added to the wall.
    expect(bayed.grossWall).toBeGreaterThan(plain.grossWall);
  });

  it("prices sunshades by the foot and scales with coverage", async () => {
    const half = await priceOf(baseMass({ features: [makeFeature("sunshade", { coverage: 0.5 })] }));
    const full = await priceOf(baseMass({ features: [makeFeature("sunshade", { coverage: 1 })] }));
    const halfLine = half.lines.find((l) => l.key === "sunshade")!;
    const fullLine = full.lines.find((l) => l.key === "sunshade")!;
    expect(fullLine.quantity).toBeCloseTo(halfLine.quantity * 2, 3);
  });

  it("prices a rooftop screen by its material", async () => {
    const mesh = await priceOf(baseMass({ features: [makeFeature("roof_screen", { material: "mesh" })] }));
    const louver = await priceOf(baseMass({ features: [makeFeature("roof_screen", { material: "louver" })] }));
    expect(louver.direct).toBeGreaterThan(mesh.direct);
  });

  it("ignores a disabled feature entirely, so an option can be toggled", async () => {
    const on = await priceOf(baseMass({ features: [makeFeature("canopy")] }));
    const off = await priceOf(baseMass({ features: [makeFeature("canopy", { disabled: true })] }));
    const plain = await priceOf(baseMass());
    expect(off.direct).toBeCloseTo(plain.direct, 6);
    expect(on.direct).toBeGreaterThan(off.direct);
  });

  it("never lets a canopy grow wider than the wall it hangs on", async () => {
    const absurd = await priceOf(
      baseMass({ w: 60, d: 60, features: [makeFeature("canopy", { width: 500, projection: 10 })] }),
    );
    const line = absurd.lines.find((l) => l.key === "canopy_cantilever")!;
    // Clamped to the 60ft wall, not the 500ft the user typed.
    expect(line.quantity).toBeCloseTo(600, 4);
  });
});

describe("plan shape changes the estimate", () => {
  it("gives a courtyard less floor area and more envelope than a rectangle", async () => {
    const rect = baseMass();
    const court = baseMass({ shape: { kind: "courtyard", courtW: 0.4, courtD: 0.4, offsetX: 0, offsetZ: 0 } });

    expect(footprint(court)).toBeLessThan(footprint(rect));
    expect(envelopeTakeoff(court).grossWall).toBeGreaterThan(envelopeTakeoff(rect).grossWall);

    const rectPrice = await priceOf(rect);
    const courtPrice = await priceOf(court);
    // Less building but more skin: the cost per square foot has to go up.
    expect(courtPrice.direct / grossArea(court)).toBeGreaterThan(rectPrice.direct / grossArea(rect));
  });

  it("gives an L more perimeter per square foot than a rectangle", () => {
    const rect = baseMass();
    const ell = baseMass({ shape: { kind: "L", armW: 0.5, armD: 0.5, notch: "ne" } });
    const rectRatio = envelopeTakeoff(rect).grossWall / footprint(rect);
    const ellRatio = envelopeTakeoff(ell).grossWall / footprint(ell);
    expect(ellRatio).toBeGreaterThan(rectRatio);
  });

  it("prices a hand-drawn plan without special-casing it", async () => {
    const custom = baseMass({
      shape: {
        kind: "polygon",
        points: [[-90, -50], [90, -50], [90, 0], [40, 50], [-90, 50]],
      },
    });
    const est = await priceOf(custom);
    expect(est.unpriced).toEqual([]);
    expect(est.direct).toBeGreaterThan(0);
    expect(footprint(custom)).toBeGreaterThan(0);
  });
});

describe("setbacks change the massing", () => {
  it("shrinks the upper plates and exposes lower roof", () => {
    const plain = baseMass({ floors: 5 });
    const stepped = baseMass({ floors: 5, stepbacks: [{ atFloor: 3, inset: 12 }] });

    const plainPlates = floorPlates(plain);
    const steppedPlates = floorPlates(stepped);

    expect(steppedPlates[2].area).toBeCloseTo(plainPlates[2].area, 4);
    expect(steppedPlates[3].area).toBeLessThan(plainPlates[3].area);
    expect(grossArea(stepped)).toBeLessThan(grossArea(plain));
    // The step creates a terrace, so there is more roof than the top plate.
    expect(roofPlates(stepped)).toBeGreaterThan(steppedPlates[4].area);
  });

  it("keeps every plate positive even at an absurd setback", () => {
    const extreme = baseMass({ floors: 4, stepbacks: [{ atFloor: 1, inset: 400 }] });
    for (const plate of floorPlates(extreme)) expect(plate.area).toBeGreaterThanOrEqual(0);
    expect(grossArea(extreme)).toBeGreaterThan(0);
  });
});
