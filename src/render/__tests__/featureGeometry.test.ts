/**
 * Every feature must draw something.
 *
 * A feature that prices but does not render is the worst failure mode this tool
 * has: the estimate quietly carries money for something the client cannot see,
 * and nobody notices until someone asks where the canopy went. These tests
 * build the actual geometry for every feature kind and check it produced real
 * triangles in a sane place.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { makeMassForType, massFootprint, type Mass } from "@/domain/massing";
import { FEATURE_LABELS, makeFeature, type FeatureKind } from "@/domain/features";
import { featureGeometries } from "../featureGeometry";
import { massBands, roofGeometry, facadeBuilds, recessOpenings, wallGeometry } from "../massGeometry";
import { pointInFootprint, type FootprintShape } from "@/domain/footprint";

const ALL_KINDS = Object.keys(FEATURE_LABELS) as FeatureKind[];

const massWith = (kind: FeatureKind, over: Partial<Mass> = {}): Mass =>
  makeMassForType("hc_mob", {
    w: 200,
    d: 120,
    floors: 4,
    shape: { kind: "rect" },
    stepbacks: [],
    features: [makeFeature(kind)],
    ...over,
  });

/** Vertex count and bounding box of a geometry, for sanity checks. */
function inspect(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  return {
    vertices: geometry.attributes.position?.count ?? 0,
    size: box.getSize(new THREE.Vector3()),
    min: box.min.clone(),
    max: box.max.clone(),
    finite:
      Number.isFinite(box.min.x) && Number.isFinite(box.max.x) &&
      Number.isFinite(box.min.y) && Number.isFinite(box.max.y),
  };
}

describe("feature geometry", () => {
  it.each(ALL_KINDS.map((k) => [k, FEATURE_LABELS[k]] as const))(
    "%s (%s) produces drawable geometry",
    (kind) => {
      const built = featureGeometries(massWith(kind));
      expect(built.length, `${kind} produced no geometry`).toBeGreaterThan(0);

      for (const part of built) {
        const info = inspect(part.geometry);
        expect(info.vertices, `${kind}/${part.material} has no vertices`).toBeGreaterThan(0);
        expect(info.finite, `${kind}/${part.material} has a non-finite bounding box`).toBe(true);
        // Nothing should be microscopic or absurdly large.
        expect(Math.max(info.size.x, info.size.y, info.size.z)).toBeGreaterThan(0.05);
        expect(Math.max(info.size.x, info.size.y, info.size.z)).toBeLessThan(2000);
      }
    },
  );

  it.each(ALL_KINDS.map((k) => [k] as const))("%s stays near the building it is attached to", (kind) => {
    const m = massWith(kind);
    for (const part of featureGeometries(m)) {
      const info = inspect(part.geometry);
      // Generous, but catches a feature flung to the origin or off into space.
      expect(Math.abs(info.min.x)).toBeLessThan(m.w * 2);
      expect(Math.abs(info.min.z)).toBeLessThan(m.d * 3);
      expect(info.max.y).toBeLessThan(m.floors * m.fth + 60);
      expect(info.min.y).toBeGreaterThan(-5);
    }
  });

  it("draws nothing for a disabled feature", () => {
    const m = massWith("canopy", { features: [makeFeature("canopy", { disabled: true })] });
    expect(featureGeometries(m)).toHaveLength(0);
  });

  it("survives a feature attached to a wall that no longer exists", () => {
    // Shape changes can leave a feature pointing at a segment index that is
    // gone. It should be skipped, not crash the whole render.
    const m = massWith("canopy", { features: [makeFeature("canopy", { segment: 99 })] });
    expect(() => featureGeometries(m)).not.toThrow();
    expect(featureGeometries(m)).toHaveLength(0);
  });

  it.each(["rect", "L", "U", "T", "courtyard", "polygon"] as const)(
    "places features correctly on a %s plan",
    (kind) => {
      const shape: FootprintShape =
        kind === "polygon"
          ? { kind: "polygon", points: [[-100, -60], [100, -60], [100, 10], [40, 60], [-100, 60]] }
          : kind === "rect"
            ? { kind: "rect" }
            : kind === "L"
              ? { kind: "L", armW: 0.5, armD: 0.5, notch: "ne" }
              : kind === "U"
                ? { kind: "U", armW: 0.25, courtD: 0.5, open: "S" }
                : kind === "T"
                  ? { kind: "T", stemW: 0.35, barD: 0.5, stem: "N" }
                  : { kind: "courtyard", courtW: 0.4, courtD: 0.4, offsetX: 0, offsetZ: 0 };

      const m = massWith("canopy", { shape, features: [makeFeature("canopy"), makeFeature("lobby")] });
      const built = featureGeometries(m);
      expect(built.length).toBeGreaterThan(0);
      for (const part of built) expect(inspect(part.geometry).finite).toBe(true);
    },
  );
});

describe("mass geometry across plan shapes", () => {
  const SHAPES: [string, FootprintShape][] = [
    ["rect", { kind: "rect" }],
    ["L", { kind: "L", armW: 0.5, armD: 0.5, notch: "ne" }],
    ["U", { kind: "U", armW: 0.25, courtD: 0.5, open: "S" }],
    ["courtyard", { kind: "courtyard", courtW: 0.4, courtD: 0.4, offsetX: 0, offsetZ: 0 }],
    ["polygon", { kind: "polygon", points: [[-100, -60], [100, -60], [100, 10], [40, 60], [-100, 60]] }],
  ];

  it.each(SHAPES)("builds walls and a roof for a %s plan", (_name, shape) => {
    const m = makeMassForType("hc_mob", { w: 200, d: 120, floors: 3, shape, features: [], stepbacks: [] });

    const builds = facadeBuilds(m);
    expect(builds.length).toBeGreaterThanOrEqual(4);
    for (const build of builds) {
      const geo = wallGeometry(build);
      expect(inspect(geo).vertices).toBeGreaterThan(0);
      expect(build.length).toBeGreaterThan(0);
    }

    const { roof } = roofGeometry(m);
    expect(inspect(roof).vertices).toBeGreaterThan(0);
  });

  it("splits a stepped mass into bands with shrinking rings", () => {
    const m = makeMassForType("hc_mob", {
      w: 200, d: 120, floors: 6, shape: { kind: "rect" }, features: [],
      stepbacks: [{ atFloor: 4, inset: 15 }],
    });
    const bands = massBands(m);
    expect(bands.length).toBe(2);
    expect(bands[0].inset).toBe(0);
    expect(bands[1].inset).toBe(15);
    expect(bands[1].baseY).toBeCloseTo(4 * m.fth, 5);
    // The upper band's ring must actually be smaller.
    const spread = (ring: [number, number][]) =>
      Math.max(...ring.map(([x]) => x)) - Math.min(...ring.map(([x]) => x));
    expect(spread(bands[1].ring)).toBeLessThan(spread(bands[0].ring));
  });
});

describe("what is priced is drawn", () => {
  /**
   * This codebase treats "priced but invisible" as its worst failure mode, and
   * material banding shipped in exactly that state: the estimate charged for
   * two cladding materials while the renderer drew one. These assertions exist
   * so it cannot happen again quietly.
   */
  it("draws a banded elevation in both of its materials", () => {
    const single = makeMassForType("hc_mob", {
      w: 200, d: 120, floors: 4, shape: { kind: "rect" }, features: [], stepbacks: [],
      skin: "brick", skinBands: [],
    });
    const banded = { ...single, skinBands: [{ fromFloor: 2, skin: "metal_panel" as const }] };

    const skinsOf = (m: Mass) => new Set(facadeBuilds(m).map((b) => b.skin));
    expect([...skinsOf(single)]).toEqual(["brick"]);
    expect([...skinsOf(banded)].sort()).toEqual(["brick", "metal_panel"]);
  });

  it("splits the wall at the band boundary, at the right height", () => {
    const m = makeMassForType("hc_mob", {
      w: 200, d: 120, floors: 4, shape: { kind: "rect" }, features: [], stepbacks: [],
      skin: "brick", skinBands: [{ fromFloor: 2, skin: "metal_panel" }],
    });

    const builds = facadeBuilds(m).filter((b) => b.side === "f");
    const brick = builds.find((b) => b.skin === "brick")!;
    const metal = builds.find((b) => b.skin === "metal_panel")!;

    expect(brick.baseY).toBeCloseTo(0, 5);
    expect(brick.floors).toBe(2);
    expect(metal.baseY).toBeCloseTo(2 * m.fth, 5);
    expect(metal.floors).toBe(2);
    // Together they cover the full height with no gap and no overlap.
    expect(brick.height + metal.height).toBeCloseTo(m.floors * m.fth, 5);
  });

  it("keeps banding working on top of a setback", () => {
    const m = makeMassForType("hc_mob", {
      w: 200, d: 120, floors: 6, shape: { kind: "rect" }, features: [],
      stepbacks: [{ atFloor: 4, inset: 12 }],
      skin: "brick", skinBands: [{ fromFloor: 3, skin: "metal_panel" }],
    });
    const builds = facadeBuilds(m);
    expect(new Set(builds.map((b) => b.skin)).size).toBe(2);
    for (const b of builds) {
      expect(b.floors).toBeGreaterThan(0);
      expect(inspect(wallGeometry(b)).vertices).toBeGreaterThan(0);
    }
  });
});

describe("recesses open the wall in front of them", () => {
  /**
   * A loggia builds its back wall, soffit and reveals set into the plan. If the
   * facade in front is left intact the whole thing is buried inside the
   * building — invisible, while the estimate charges for it AND takes floor
   * area away for it. This is the priced-but-never-drawn failure exactly.
   */
  const openingsFor = (mass: Mass) =>
    facadeBuilds(mass).flatMap((b) => recessOpenings(mass, b.segment, b.fromFloor, b.fromFloor + b.floors - 1));

  it("punches an opening for a loggia", () => {
    const mass = massWith("loggia", { glz: "none" });
    const holes = openingsFor(mass);
    expect(holes.length).toBeGreaterThan(0);
    expect(holes[0].width).toBeGreaterThan(0);
    expect(holes[0].height).toBeGreaterThan(0);
  });

  it("punches nothing when there is no recess on the wall", () => {
    expect(openingsFor(massWith("canopy", { glz: "none" }))).toEqual([]);
    expect(openingsFor(massWith("bay", { glz: "none" }))).toEqual([]);
  });

  it("opens for a recessed balcony but not a projecting one", () => {
    const recessed = massWith("balcony", { glz: "none", features: [makeFeature("balcony", { recessed: true } as never)] });
    const hung = massWith("balcony", { glz: "none", features: [makeFeature("balcony", { recessed: false } as never)] });
    expect(openingsFor(recessed).length).toBeGreaterThan(0);
    expect(openingsFor(hung)).toEqual([]);
  });

  it("punches nothing for a feature switched off", () => {
    const mass = massWith("loggia", {
      glz: "none",
      features: [makeFeature("loggia", { disabled: true })],
    });
    expect(openingsFor(mass)).toEqual([]);
  });

  it("keeps the opening inside the wall it belongs to", () => {
    for (const along of [0, 0.25, 0.5, 0.75, 1]) {
      const mass = massWith("loggia", {
        glz: "none",
        features: [makeFeature("loggia", { along, width: 40 } as never)],
      });
      for (const build of facadeBuilds(mass)) {
        for (const o of recessOpenings(mass, build.segment, build.fromFloor, build.fromFloor + build.floors - 1)) {
          expect(o.u).toBeGreaterThanOrEqual(-1e-6);
          expect(o.u + o.width).toBeLessThanOrEqual(build.length + 1e-6);
        }
      }
    }
  });

  // A wall is split into runs wherever the cladding changes, so one loggia can
  // arrive as several openings. What must hold is the total.
  const openHeight = (mass: Mass) =>
    openingsFor(mass).reduce((a, o) => a + o.height, 0);

  it("covers the floors the loggia spans and no others", () => {
    const mass = massWith("loggia", {
      glz: "none",
      floors: 6,
      features: [makeFeature("loggia", { fromFloor: 2, toFloor: 3 } as never)],
    });
    expect(openHeight(mass)).toBeCloseTo(2 * mass.fth, 6);
  });

  it("never opens above the top floor", () => {
    const mass = massWith("loggia", {
      glz: "none",
      floors: 3,
      features: [makeFeature("loggia", { fromFloor: 0, toFloor: 99 } as never)],
    });
    expect(openHeight(mass)).toBeCloseTo(3 * mass.fth, 6);
    for (const build of facadeBuilds(mass)) {
      for (const o of recessOpenings(mass, build.segment, build.fromFloor, build.fromFloor + build.floors - 1)) {
        expect(o.v + o.height).toBeLessThanOrEqual(build.height + 1e-6);
      }
    }
  });

  it("puts the hole where the recess geometry actually is", () => {
    // The opening is derived from world positions, so it must land on the same
    // side of the wall as the recess no matter how the polygon is wound.
    const mass = massWith("loggia", {
      glz: "none",
      shape: { kind: "rect" },
      features: [makeFeature("loggia", { along: 0.2, width: 30 } as never)],
    });
    const built = facadeBuilds(mass).filter(
      (b) => recessOpenings(mass, b.segment, b.fromFloor, b.fromFloor + b.floors - 1).length > 0,
    );
    expect(built.length).toBeGreaterThan(0);
    // Every run carrying the opening must agree on which wall it is.
    expect(new Set(built.map((b) => b.segment.index)).size).toBe(1);
    const build = built[0];
    const [hole] = recessOpenings(mass, build.segment, build.fromFloor, build.fromFloor + build.floors - 1);

    // Where the hole's centre lands in world space.
    const centre = hole.u + hole.width / 2 - build.length / 2;
    const nx = build.segment.normal[0];
    const nz = build.segment.normal[1];
    const holeX = build.position.x + centre * nz;
    const holeZ = build.position.z - centre * nx;

    // Where the recess geometry actually is.
    const geo = featureGeometries(mass).find((g) => g.material === "wall")!.geometry;
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(holeX).toBeGreaterThan(box.min.x - 3);
    expect(holeX).toBeLessThan(box.max.x + 3);
    expect(holeZ).toBeGreaterThan(box.min.z - 3);
    expect(holeZ).toBeLessThan(box.max.z + 3);
  });

  it("cuts a real hole in the wall geometry", () => {
    const solid = massWith("canopy", { glz: "none" });
    const withLoggia = massWith("loggia", { glz: "none" });
    const area = (mass: Mass) =>
      facadeBuilds(mass)
        .map((b) => wallGeometry(b).attributes.position.count)
        .reduce((a, n) => a + n, 0);
    expect(area(withLoggia)).toBeGreaterThan(area(solid));
  });
});

describe("a roof terrace lands on the roof", () => {
  /**
   * The deck centre used to be the mean of the outline's VERTICES, which is
   * not the centre of anything. On an L it lands in the notch, so a terrace
   * the estimate was charging for hung in mid-air outside the building.
   */
  const cornersOf = (geo: THREE.BufferGeometry) => {
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    return [
      [b.min.x, b.min.z], [b.max.x, b.min.z],
      [b.min.x, b.max.z], [b.max.x, b.max.z],
      [(b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2],
    ] as const;
  };

  const SHAPES: [string, FootprintShape][] = [
    ["rectangle", { kind: "rect" }],
    ["L", { kind: "L", armW: 0.45, armD: 0.5, notch: "ne" }],
    ["L, other corner", { kind: "L", armW: 0.5, armD: 0.45, notch: "sw" }],
    ["U", { kind: "U", armW: 0.3, courtD: 0.5, open: "S" }],
    ["T", { kind: "T", stemW: 0.35, barD: 0.4, stem: "N" }],
    ["courtyard, off centre", { kind: "courtyard", courtW: 0.3, courtD: 0.3, offsetX: 0.2, offsetZ: -0.15 }],
  ];

  for (const [label, shape] of SHAPES) {
    it(`sits inside the building — ${label}`, () => {
      const mass = massWith("terrace", { w: 220, d: 180, floors: 5, shape });
      const plan = massFootprint(mass);
      const parts = featureGeometries(mass);
      expect(parts.length).toBeGreaterThan(0);
      for (const part of parts) {
        for (const [px, pz] of cornersOf(part.geometry)) {
          expect(
            pointInFootprint(plan, px, pz),
            `${label}: ${part.material} reaches (${px.toFixed(0)},${pz.toFixed(0)}), outside the building`,
          ).toBe(true);
        }
      }
    });
  }

  it("keeps the deck clear of a courtyard rather than spanning it", () => {
    const mass = massWith("terrace", {
      w: 260, d: 220, floors: 4,
      shape: { kind: "courtyard", courtW: 0.45, courtD: 0.45, offsetX: 0, offsetZ: 0 },
    });
    const plan = massFootprint(mass);
    for (const part of featureGeometries(mass)) {
      for (const [px, pz] of cornersOf(part.geometry)) {
        expect(pointInFootprint(plan, px, pz)).toBe(true);
      }
    }
  });
});
