/**
 * The roof must sit over the building.
 *
 * The roof slab was built mirrored in Z. On a rectangle, and on a centred
 * courtyard, a mirror is invisible — which is exactly why it survived every
 * test and every render until someone drew an L. On an L it put the roof over
 * the notch, where there is no building, and left open sky over real floor
 * area the estimate was charging roof for.
 *
 * These tests sample the actual triangles, so they check where the geometry
 * IS rather than what the code meant.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { makeMassForType, massFootprint, type Mass } from "@/domain/massing";
import { outerRing, holeRings, ringArea } from "@/domain/footprint";
import type { FootprintShape } from "@/domain/footprint";
import { roofGeometry } from "../massGeometry";

/** Does any triangle of this geometry cover (px, pz) when seen from above? */
function coversXZ(geo: THREE.BufferGeometry, px: number, pz: number): boolean {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const n = idx ? idx.count : pos.count;
  const at = (i: number) => {
    const k = idx ? idx.getX(i) : i;
    return [pos.getX(k), pos.getZ(k)] as const;
  };
  for (let i = 0; i < n; i += 3) {
    const [ax, az] = at(i), [bx, bz] = at(i + 1), [cx, cz] = at(i + 2);
    const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
    const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
    const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
  }
  return false;
}

/** Ray-cast a plan point against the footprint ring. */
function insidePlan(mass: Mass, px: number, pz: number): boolean {
  const plan = massFootprint(mass);
  const hit = (ring: readonly (readonly [number, number])[]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  if (!hit(outerRing(plan))) return false;
  return !holeRings(plan).some((h) => hit(h));
}

const mob = (shape: FootprintShape, over: Partial<Mass> = {}): Mass =>
  makeMassForType("hc_mob", { w: 400, d: 200, floors: 4, stepbacks: [], features: [], shape, ...over });

/**
 * A grid of plan points, so the check is about the whole roof rather than one
 * spot. Points sitting on the outline are skipped: a triangle test counts an
 * edge as covered and a ray cast counts it as outside, and neither is wrong —
 * the question is only meaningful away from the boundary.
 */
function scan(mass: Mass, clearance = 3) {
  const { roof } = roofGeometry(mass);
  const missing: string[] = [];
  const spurious: string[] = [];

  for (let px = -180; px <= 180; px += 20) {
    for (let pz = -90; pz <= 90; pz += 15) {
      const corners = [
        [px - clearance, pz - clearance], [px + clearance, pz - clearance],
        [px - clearance, pz + clearance], [px + clearance, pz + clearance],
      ] as const;
      const should = insidePlan(mass, px, pz);
      if (corners.some(([cx, cz]) => insidePlan(mass, cx, cz) !== should)) continue;

      const does = coversXZ(roof, px, pz);
      if (should && !does) missing.push(`(${px},${pz})`);
      if (!should && does) spurious.push(`(${px},${pz})`);
    }
  }
  return { missing, spurious };
}

describe("the roof follows the plan", () => {
  const SHAPES: [string, FootprintShape][] = [
    ["rectangle", { kind: "rect" }],
    ["L, notch NE", { kind: "L", armW: 0.45, armD: 0.5, notch: "ne" }],
    ["L, notch SW", { kind: "L", armW: 0.6, armD: 0.35, notch: "sw" }],
    ["U opening south", { kind: "U", armW: 0.3, courtD: 0.5, open: "S" }],
    ["T stem north", { kind: "T", stemW: 0.35, barD: 0.4, stem: "N" }],
    ["courtyard, off centre", { kind: "courtyard", courtW: 0.3, courtD: 0.3, offsetX: 0.2, offsetZ: -0.15 }],
    ["hand-drawn polygon", {
      kind: "polygon",
      points: [[-200, -100], [200, -100], [200, 20], [60, 20], [60, 100], [-200, 100]],
    }],
  ];

  for (const [label, shape] of SHAPES) {
    it(`covers the building and nothing else — ${label}`, () => {
      const { missing, spurious } = scan(mob(shape));
      expect(missing, `no roof over: ${missing.join(" ")}`).toEqual([]);
      expect(spurious, `roof over open air at: ${spurious.join(" ")}`).toEqual([]);
    });
  }

  it("is the mirror test that a rectangle cannot fail", () => {
    // Stated explicitly so nobody 'simplifies' the asymmetric cases away: a
    // rectangle passes whether the roof is mirrored or not.
    const rect = mob({ kind: "rect" });
    expect(scan(rect).spurious).toEqual([]);
    const l = mob({ kind: "L", armW: 0.45, armD: 0.5, notch: "ne" });
    expect(insidePlan(l, 120, 60)).toBe(false);
    expect(insidePlan(l, 120, -60)).toBe(true);
  });

  it("roofs the same area the takeoff prices", () => {
    for (const [, shape] of SHAPES) {
      const mass = mob(shape);
      const plan = massFootprint(mass);
      const { roof } = roofGeometry(mass);
      roof.computeBoundingBox();
      const box = roof.boundingBox!;
      // The slab may not exceed the plan's own bounding box.
      expect(box.min.x).toBeGreaterThanOrEqual(-mass.w / 2 - 1);
      expect(box.max.x).toBeLessThanOrEqual(mass.w / 2 + 1);
      expect(box.min.z).toBeGreaterThanOrEqual(-mass.d / 2 - 1);
      expect(box.max.z).toBeLessThanOrEqual(mass.d / 2 + 1);
      expect(ringArea(outerRing(plan))).toBeGreaterThan(0);
    }
  });

  it("keeps the roof facing up", () => {
    // A mirror flips the winding, and a roof whose normals point down is
    // backface-culled into thin air — a fix that moves it correctly and makes
    // it invisible is not a fix.
    const { roof } = roofGeometry(mob({ kind: "L", armW: 0.45, armD: 0.5, notch: "ne" }));
    roof.computeVertexNormals();
    const n = roof.attributes.normal;
    let up = 0;
    for (let i = 0; i < n.count; i++) if (n.getY(i) > 0.9) up++;
    expect(up).toBeGreaterThan(0);
  });
});
