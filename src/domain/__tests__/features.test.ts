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
import { copyFeature, makeFeature, resetFeatureSeq, type Feature } from "../features";
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
    // Everything the building type seeds is cleared here. A test measuring one
    // variable has to start from a controlled baseline, and the type is
    // deliberately opinionated about all of these.
    skinBands: [],
    roofAssembly: "membrane",
    parapet: 3.5,
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

describe("the expanded vocabulary", () => {
  const priceKeys = async (m: Mass) => {
    const est = await priceOf(m);
    return new Map(est.lines.map((l) => [l.key, l]));
  };

  it("prices brise-soleil more the deeper and closer-spaced the fins", async () => {
    // Measured on the line, not the building total: a fin array is a real
    // decision but a small fraction of a whole MOB, so a total-cost assertion
    // would pass or fail on rounding rather than on the thing under test.
    const shallow = (await priceKeys(baseMass({ features: [makeFeature("brise_soleil", { projection: 1.5, spacing: 6 })] })))
      .get("brise_soleil")!;
    const deep = (await priceKeys(baseMass({ features: [makeFeature("brise_soleil", { projection: 4, spacing: 2 })] })))
      .get("brise_soleil")!;

    // Three times the fins at nearly three times the depth.
    expect(deep.quantity).toBeGreaterThan(shallow.quantity * 5);
    expect(deep.amount).toBeGreaterThan(shallow.amount * 5);
  });

  it("charges a projecting balcony more than a recessed one, and takes area for the recess", async () => {
    const projecting = baseMass({
      floors: 4,
      features: [makeFeature("balcony", { recessed: false, count: 4, fromFloor: 1, toFloor: 3 })],
    });
    const recessed = baseMass({
      floors: 4,
      features: [makeFeature("balcony", { recessed: true, count: 4, fromFloor: 1, toFloor: 3 })],
    });

    expect((await priceOf(projecting)).direct).toBeGreaterThan((await priceOf(recessed)).direct);
    // A recessed balcony is carved out of the plate, so the building shrinks.
    expect(grossArea(recessed)).toBeLessThan(grossArea(projecting));
  });

  it("gives every balcony a guard rail", async () => {
    const lines = await priceKeys(baseMass({ features: [makeFeature("balcony", { count: 3 })] }));
    expect(lines.get("guard_rail")?.quantity).toBeGreaterThan(0);
  });

  it("makes a loggia remove floor area and add soffit", async () => {
    const plain = baseMass();
    const withLoggia = baseMass({ features: [makeFeature("loggia", { width: 24, depth: 10 })] });
    expect(grossArea(withLoggia)).toBeLessThan(grossArea(plain));
    expect((await priceKeys(withLoggia)).get("loggia_soffit")?.quantity).toBeCloseTo(240, 4);
  });

  it("turns a feature corner into curtain wall on both elevations", async () => {
    const lines = await priceKeys(
      baseMass({ features: [makeFeature("feature_corner", { wrap: 18, fromFloor: 0, toFloor: 2 })] }),
    );
    // Two walls, three floors, 18ft of wrap at 14ft floor to floor.
    expect(lines.get("curtain")?.quantity).toBeGreaterThanOrEqual(2 * 18 * 3 * 14);
  });

  it("cuts an atrium out of every floor above the ground and glazes the lid", async () => {
    const plain = baseMass({ floors: 4 });
    const withAtrium = baseMass({
      floors: 4,
      features: [makeFeature("atrium", { width: 40, depth: 30, floors: 4, skylight: true })],
    });

    // Three floors above ground lose the 1,200 SF void.
    expect(grossArea(plain) - grossArea(withAtrium)).toBeCloseTo(3600, 0);
    const lines = await priceKeys(withAtrium);
    expect(lines.get("skylight")?.quantity).toBeCloseTo(1200, 4);
    expect(lines.get("atrium_glazing")?.quantity).toBeGreaterThan(0);
  });

  it("prices a connector as structure, floor and envelope at once", async () => {
    const lines = await priceKeys(baseMass({ features: [makeFeature("connector", { length: 40, width: 14 })] }));
    expect(lines.get("connector_structure")?.quantity).toBeCloseTo(560, 4);
    expect(lines.get("curtain")?.quantity).toBeGreaterThan(0);
  });

  it("prices a terrace with rail and planters", async () => {
    const lines = await priceKeys(
      baseMass({ features: [makeFeature("terrace", { area: 2000, railing: 140, planters: true })] }),
    );
    expect(lines.get("terrace_deck")?.quantity).toBeCloseTo(2000, 4);
    expect(lines.get("guard_rail")?.quantity).toBeCloseTo(140, 4);
    expect(lines.get("planter")?.quantity).toBeGreaterThan(0);
  });

  it("prices plaza paving by its grade", async () => {
    const plain = await priceOf(baseMass({ features: [makeFeature("plaza", { grade: "plain", seatWall: 0 })] }));
    const feature = await priceOf(baseMass({ features: [makeFeature("plaza", { grade: "feature", seatWall: 0 })] }));
    expect(feature.direct).toBeGreaterThan(plain.direct);
  });

  it("prices a pergola by material", async () => {
    const timber = await priceOf(baseMass({ features: [makeFeature("pergola", { material: "timber" })] }));
    const aluminium = await priceOf(baseMass({ features: [makeFeature("pergola", { material: "aluminium" })] }));
    expect(aluminium.direct).toBeGreaterThan(timber.direct);
  });
});

describe("roof assembly and parapet", () => {
  it("swaps the roof rate rather than stacking on it", async () => {
    const membrane = await priceOf(baseMass({ roofAssembly: "membrane" }));
    const green = await priceOf(baseMass({ roofAssembly: "green_intensive" }));

    const membraneKeys = membrane.lines.map((l) => l.key);
    const greenKeys = green.lines.map((l) => l.key);
    // A green roof replaces the membrane line; it does not appear alongside it.
    expect(greenKeys).toContain("roof_green_intensive");
    expect(greenKeys).not.toContain("roof");
    expect(membraneKeys).toContain("roof");
    expect(green.direct).toBeGreaterThan(membrane.direct);
  });

  it("orders the roof assemblies sensibly", async () => {
    const prices = await Promise.all(
      (["membrane", "ballasted", "pv_ready", "green_extensive", "green_intensive"] as const).map(async (a) => ({
        a,
        direct: (await priceOf(baseMass({ roofAssembly: a }))).direct,
      })),
    );
    const by = Object.fromEntries(prices.map((p) => [p.a, p.direct]));
    expect(by.green_intensive).toBeGreaterThan(by.green_extensive);
    expect(by.green_extensive).toBeGreaterThan(by.membrane);
    expect(by.pv_ready).toBeGreaterThan(by.membrane);
  });

  it("only charges for parapet above the code minimum", async () => {
    const standard = await priceOf(baseMass({ parapet: 3.5 }));
    const tall = await priceOf(baseMass({ parapet: 8 }));
    expect(standard.lines.some((l) => l.key === "parapet_wall")).toBe(false);
    expect(tall.lines.some((l) => l.key === "parapet_wall")).toBe(true);
    expect(tall.direct).toBeGreaterThan(standard.direct);
  });
});

describe("material banding", () => {
  it("splits the elevation into the materials it is actually clad in", () => {
    const single = envelopeTakeoff(baseMass({ skin: "brick" }));
    const banded = envelopeTakeoff(
      baseMass({ skin: "brick", skinBands: [{ fromFloor: 1, skin: "metal_panel" }] }),
    );

    expect(Object.keys(single.opaqueBySkin)).toEqual(["brick"]);
    expect(Object.keys(banded.opaqueBySkin).sort()).toEqual(["brick", "metal_panel"]);
    // Total opaque area is unchanged; only how it is attributed.
    expect(banded.opaque).toBeCloseTo(single.opaque, 4);
  });

  it("prices a banded elevation between its two materials", async () => {
    const allBrick = await priceOf(baseMass({ skin: "brick" }));
    const allMetal = await priceOf(baseMass({ skin: "metal_panel" }));
    const banded = await priceOf(
      baseMass({ skin: "brick", skinBands: [{ fromFloor: 1, skin: "metal_panel" }] }),
    );
    const [cheaper, dearer] = [allBrick.direct, allMetal.direct].sort((a, b) => a - b);
    expect(banded.direct).toBeGreaterThan(cheaper);
    expect(banded.direct).toBeLessThan(dearer);
  });
});

describe("copying a feature", () => {
  it("gives the copy its own identity", () => {
    const source = makeFeature("canopy", { width: 33, projection: 11 });
    const copy = copyFeature(source);
    expect(copy.id).not.toBe(source.id);
    expect(copy.id).toBeTruthy();
  });

  it("carries every parameter across", () => {
    const source = makeFeature("porte_cochere", {
      width: 52, projection: 30, height: 17, columns: 4, segment: 2, along: 0.3,
    } as Partial<Feature>);
    const copy = copyFeature(source);
    const { id: _a, ...sourceRest } = source;
    const { id: _b, ...copyRest } = copy;
    expect(copyRest).toEqual(sourceRest);
  });

  it("applies an override on top of the source", () => {
    const source = makeFeature("balcony", { along: 0.5 } as Partial<Feature>);
    const copy = copyFeature(source, { along: 0.68 });
    expect(copy.along).toBeCloseTo(0.68, 6);
    expect(source.along).toBeCloseTo(0.5, 6);
  });

  it("copies a disabled feature as disabled", () => {
    const copy = copyFeature(makeFeature("bay", { disabled: true }));
    expect(copy.disabled).toBe(true);
  });

  it("keeps the two independent, so editing one leaves the other alone", () => {
    const source = makeFeature("lobby");
    const copy = copyFeature(source);
    const features = [source, copy];
    const edited = features.map((f) => (f.id === copy.id ? { ...f, width: 99 } : f));
    expect((edited[0] as { width: number }).width).not.toBe(99);
    expect((edited[1] as { width: number }).width).toBe(99);
    // And deleting one leaves exactly one behind, which is the bug that was shipped.
    expect(features.filter((f) => f.id !== copy.id)).toHaveLength(1);
  });
});
