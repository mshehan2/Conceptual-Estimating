/**
 * Footprint geometry.
 *
 * The invariant that matters: presets and hand-drawn polygons are the same
 * thing downstream. Every assertion here that applies to a preset is applied to
 * a custom polygon too, because the moment those diverge, custom geometry
 * becomes a second-class path that quietly breaks.
 */

import { describe, expect, it } from "vitest";
import {
  facadeSegments,
  footprintArea,
  footprintBounds,
  footprintPerimeter,
  holeRings,
  outerRing,
  resizeFootprint,
  ringArea,
  signedArea,
  type Footprint,
  type Point,
} from "../footprint";

const ALL: Footprint[] = [
  { kind: "rect", w: 160, d: 80 },
  { kind: "L", w: 200, d: 120, armW: 0.45, armD: 0.4, notch: "ne" },
  { kind: "L", w: 200, d: 120, armW: 0.45, armD: 0.4, notch: "sw" },
  { kind: "U", w: 220, d: 140, armW: 0.28, courtD: 0.55, open: "S" },
  { kind: "U", w: 220, d: 140, armW: 0.28, courtD: 0.55, open: "E" },
  { kind: "T", w: 200, d: 140, stemW: 0.35, barD: 0.45, stem: "N" },
  { kind: "courtyard", w: 200, d: 160, courtW: 0.4, courtD: 0.4, offsetX: 0, offsetZ: 0 },
  {
    kind: "polygon",
    w: 180,
    d: 120,
    // A deliberately awkward site-shaped plan: non-orthogonal and concave.
    points: [
      [-90, -60], [90, -60], [90, 10], [30, 60], [-40, 60], [-90, 20],
    ] as Point[],
  },
];

const label = (f: Footprint) => `${f.kind}${"notch" in f ? `/${f.notch}` : ""}${"open" in f ? `/${f.open}` : ""}`;

describe("footprint geometry", () => {
  it.each(ALL.map((f) => [label(f), f] as const))("%s produces a well-formed ring", (_name, f) => {
    const ring = outerRing(f);
    expect(ring.length).toBeGreaterThanOrEqual(4);
    // Counter-clockwise, so outward normals point out rather than in.
    expect(signedArea(ring)).toBeGreaterThan(0);
    expect(ringArea(ring)).toBeGreaterThan(0);
  });

  it.each(ALL.map((f) => [label(f), f] as const))("%s has positive area and perimeter", (_name, f) => {
    expect(footprintArea(f)).toBeGreaterThan(0);
    expect(footprintPerimeter(f)).toBeGreaterThan(0);
  });

  it.each(ALL.map((f) => [label(f), f] as const))("%s closes: segment lengths sum to the perimeter", (_name, f) => {
    const segments = facadeSegments(f);
    const summed = segments.reduce((a, s) => a + s.length, 0);
    expect(summed).toBeCloseTo(footprintPerimeter(f), 4);
  });

  it.each(ALL.map((f) => [label(f), f] as const))("%s gives every wall an outward unit normal", (_name, f) => {
    for (const s of facadeSegments(f)) {
      expect(Math.hypot(s.normal[0], s.normal[1])).toBeCloseTo(1, 6);
      expect(s.length).toBeGreaterThan(0);
      expect(["N", "E", "S", "W"]).toContain(s.cardinal);
    }
  });

  it("measures a rectangle exactly", () => {
    const f: Footprint = { kind: "rect", w: 160, d: 80 };
    expect(footprintArea(f)).toBeCloseTo(160 * 80, 6);
    expect(footprintPerimeter(f)).toBeCloseTo(2 * (160 + 80), 6);
    expect(facadeSegments(f)).toHaveLength(4);
  });

  it("cuts an L smaller than its bounding box but larger than either limb", () => {
    const f: Footprint = { kind: "L", w: 200, d: 120, armW: 0.5, armD: 0.5, notch: "ne" };
    const area = footprintArea(f);
    expect(area).toBeLessThan(200 * 120);
    // Two limbs of half width/depth overlapping at the corner = 3/4 of the box.
    expect(area).toBeCloseTo(200 * 120 * 0.75, 4);
    expect(facadeSegments(f)).toHaveLength(6);
  });

  it("opens a U toward the side it was told to", () => {
    for (const open of ["N", "E", "S", "W"] as const) {
      const f: Footprint = { kind: "U", w: 200, d: 140, armW: 0.25, courtD: 0.5, open };
      const segments = facadeSegments(f);
      expect(segments).toHaveLength(8);
      // The court's back wall faces the opening, so a wall must look that way.
      expect(segments.some((s) => s.cardinal === open)).toBe(true);
      expect(footprintArea(f)).toBeLessThan(200 * 140);
    }
  });

  it("wraps a courtyard so the court walls face inward", () => {
    const f: Footprint = { kind: "courtyard", w: 200, d: 160, courtW: 0.4, courtD: 0.4, offsetX: 0, offsetZ: 0 };
    const court = holeRings(f);
    expect(court).toHaveLength(1);

    // Area is the ring, not the whole box.
    expect(footprintArea(f)).toBeCloseTo(200 * 160 - 80 * 64, 4);
    // Perimeter counts both the outside and the court.
    expect(footprintPerimeter(f)).toBeCloseTo(2 * (200 + 160) + 2 * (80 + 64), 4);

    const segments = facadeSegments(f);
    expect(segments.filter((s) => s.courtFacing)).toHaveLength(4);

    // A court wall's normal must point back toward the court centre.
    for (const s of segments.filter((x) => x.courtFacing)) {
      const midX = (s.start[0] + s.end[0]) / 2;
      const midZ = (s.start[1] + s.end[1]) / 2;
      const towardCentre = -midX * s.normal[0] - midZ * s.normal[1];
      expect(towardCentre).toBeGreaterThan(0);
    }
  });

  it("treats a hand-drawn polygon exactly like a preset", () => {
    const custom = ALL.find((f) => f.kind === "polygon")!;
    const segments = facadeSegments(custom);

    expect(segments.length).toBe(6);
    expect(footprintArea(custom)).toBeGreaterThan(0);
    expect(segments.reduce((a, s) => a + s.length, 0)).toBeCloseTo(footprintPerimeter(custom), 4);
    // Non-orthogonal edges must survive, not get snapped to a cardinal box.
    expect(segments.some((s) => s.bearing % 90 > 0.01)).toBe(true);
  });

  it("corrects clockwise input rather than rejecting it", () => {
    // A survey or DXF export can wind either way; both must work.
    const ccw: Point[] = [[-50, -30], [50, -30], [50, 30], [-50, 30]];
    const cw = [...ccw].reverse();
    const a: Footprint = { kind: "polygon", w: 100, d: 60, points: ccw };
    const b: Footprint = { kind: "polygon", w: 100, d: 60, points: cw };
    expect(footprintArea(a)).toBeCloseTo(footprintArea(b), 6);
    expect(signedArea(outerRing(b))).toBeGreaterThan(0);
  });

  it("resizes a custom polygon proportionally", () => {
    const custom = ALL.find((f) => f.kind === "polygon")! as Extract<Footprint, { kind: "polygon" }>;
    const scaled = resizeFootprint(custom, 360, 240);
    const bounds = footprintBounds(scaled);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(360, 4);
    expect(bounds.maxZ - bounds.minZ).toBeCloseTo(240, 4);
    // Twice the size in both directions is four times the area.
    expect(footprintArea(scaled)).toBeCloseTo(footprintArea(custom) * 4, 2);
  });

  it("never collapses a limb to nothing at extreme parameters", () => {
    const extremes: Footprint[] = [
      { kind: "L", w: 100, d: 60, armW: 0.99, armD: 0.99, notch: "ne" },
      { kind: "L", w: 100, d: 60, armW: 0.01, armD: 0.01, notch: "ne" },
      { kind: "U", w: 100, d: 60, armW: 0.99, courtD: 0.99, open: "N" },
      { kind: "courtyard", w: 100, d: 60, courtW: 0.99, courtD: 0.99, offsetX: 0.9, offsetZ: 0.9 },
    ];
    for (const f of extremes) {
      expect(footprintArea(f)).toBeGreaterThan(0);
      for (const s of facadeSegments(f)) expect(s.length).toBeGreaterThan(0);
    }
  });
});
