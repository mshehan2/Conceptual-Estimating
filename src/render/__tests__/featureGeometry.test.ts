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
import { makeMassForType, type Mass } from "@/domain/massing";
import { FEATURE_LABELS, makeFeature, type FeatureKind } from "@/domain/features";
import { featureGeometries } from "../featureGeometry";
import { massBands, roofGeometry, facadeBuilds, wallGeometry } from "../massGeometry";
import type { FootprintShape } from "@/domain/footprint";

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
