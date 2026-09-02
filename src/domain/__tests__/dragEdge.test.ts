/**
 * Pulling a wall in makes the building longer, not smaller.
 *
 * The area is the fixed thing and the proportion is the question. A 10,000 SF
 * building that is 100 by 100 does not become 5,000 SF when you decide it can
 * only be 50 feet deep; it becomes 200 feet wide.
 */

import { describe, expect, it } from "vitest";
import { dragEdgePreservingArea, outerRing, ringArea, footprintBounds } from "../footprint";
import type { Point } from "../footprint";

const rect = (w: number, d: number): Point[] => [
  [-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2],
];

const bounds = (ring: Point[]) => {
  const xs = ring.map((p) => p[0]);
  const zs = ring.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) };
};

/** Which edge of a rectangle faces north (+z). */
const northEdge = (ring: Point[]) => {
  let best = 0;
  let bestZ = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const midZ = (ring[i][1] + ring[(i + 1) % ring.length][1]) / 2;
    if (midZ > bestZ) { bestZ = midZ; best = i; }
  }
  return best;
};

describe("the worked example", () => {
  it("turns a 100 by 100 into a 200 by 50 when the north wall is pulled to 50 deep", () => {
    const start = rect(100, 100);
    const area = ringArea(start);
    expect(area).toBe(10_000);

    // Pull the north wall 50 feet inward.
    const out = dragEdgePreservingArea(start, northEdge(start), -50, area)!;
    expect(out).not.toBeNull();

    const b = bounds(out);
    expect(b.d).toBeCloseTo(50, 6);
    expect(b.w).toBeCloseTo(200, 6);
    expect(ringArea(out)).toBeCloseTo(10_000, 6);
  });

  it("works the other way: pushing out makes it narrower", () => {
    const start = rect(100, 100);
    const out = dragEdgePreservingArea(start, northEdge(start), 100, 10_000)!;
    const b = bounds(out);
    expect(b.d).toBeCloseTo(200, 6);
    expect(b.w).toBeCloseTo(50, 6);
    expect(ringArea(out)).toBeCloseTo(10_000, 6);
  });
});

describe("area is held whatever the shape", () => {
  const SHAPES: [string, Point[]][] = [
    ["rectangle", rect(200, 100)],
    ["long bar", rect(400, 60)],
    ["L", [[-100, -50], [100, -50], [100, 0], [-10, 0], [-10, 50], [-100, 50]]],
    ["U", [[-120, -60], [120, -60], [120, 60], [70, 60], [70, -10], [-70, -10], [-70, 60], [-120, 60]]],
    ["T", [[-120, -60], [120, -60], [120, -10], [30, -10], [30, 60], [-30, 60], [-30, -10], [-120, -10]]],
    ["hand drawn, slanted", [[-100, -60], [110, -40], [90, 55], [-80, 45]]],
  ];

  for (const [label, ring] of SHAPES) {
    it(`holds area through a drag: ${label}`, () => {
      const area = ringArea(ring);
      for (const edge of ring.map((_, i) => i)) {
        for (const dist of [-20, -8, 8, 25]) {
          const out = dragEdgePreservingArea(ring, edge, dist, area);
          if (!out) continue; // a refused drag is allowed, a wrong one is not
          expect(ringArea(out), `${label} edge ${edge} by ${dist}`).toBeCloseTo(area, 4);
        }
      }
    });
  }
});

describe("the dragged wall stays where it was put", () => {
  it("keeps the depth the drag asked for, then compensates in width", () => {
    const start = rect(160, 80);
    const area = ringArea(start);
    for (const target of [40, 60, 100, 140]) {
      const out = dragEdgePreservingArea(start, northEdge(start), target - 80, area)!;
      const b = bounds(out);
      expect(b.d, `target depth ${target}`).toBeCloseTo(target, 4);
      expect(b.w * b.d).toBeCloseTo(area, 4);
    }
  });

  it("moves only the grabbed wall, leaving the opposite one alone on a rectangle", () => {
    const start = rect(100, 100);
    const out = dragEdgePreservingArea(start, northEdge(start), -50, 10_000)!;
    // South edge is still at -50; the north edge came to 0.
    const zs = out.map((p) => p[1]).sort((a, b) => a - b);
    expect(zs[0]).toBeCloseTo(-50, 6);
    expect(zs[zs.length - 1]).toBeCloseTo(0, 6);
  });
});

describe("it refuses rather than producing nonsense", () => {
  it("will not collapse a plan through itself", () => {
    const start = rect(100, 100);
    expect(dragEdgePreservingArea(start, northEdge(start), -100, 10_000)).toBeNull();
    expect(dragEdgePreservingArea(start, northEdge(start), -140, 10_000)).toBeNull();
  });

  it("rejects a bad edge index, a degenerate ring or a zero target", () => {
    const start = rect(100, 100);
    expect(dragEdgePreservingArea(start, -1, 10, 10_000)).toBeNull();
    expect(dragEdgePreservingArea(start, 9, 10, 10_000)).toBeNull();
    expect(dragEdgePreservingArea(start, 0, 10, 0)).toBeNull();
    expect(dragEdgePreservingArea([[0, 0], [1, 1]], 0, 10, 100)).toBeNull();
  });

  it("holds a target area different from the current one", () => {
    // Growing the programme and reshaping at the same time.
    const start = rect(100, 100);
    const out = dragEdgePreservingArea(start, northEdge(start), -50, 20_000)!;
    expect(ringArea(out)).toBeCloseTo(20_000, 6);
    expect(bounds(out).d).toBeCloseTo(50, 6);
  });
});

describe("an L keeps its notch", () => {
  it("stays concave after a drag rather than being squared off", () => {
    const L: Point[] = [[-100, -50], [100, -50], [100, 0], [-10, 0], [-10, 50], [-100, 50]];
    const area = ringArea(L);
    const out = dragEdgePreservingArea(L, 0, -15, area)!;
    expect(out).toHaveLength(6);
    // The bounding box still exceeds the polygon: the notch survived.
    const b = footprintBounds({ kind: "polygon", w: 200, d: 100, points: out });
    expect((b.maxX - b.minX) * (b.maxZ - b.minZ)).toBeGreaterThan(ringArea(out) * 1.15);
  });

  it("is reachable through outerRing on a polygon footprint", () => {
    const L: Point[] = [[-100, -50], [100, -50], [100, 0], [-10, 0], [-10, 50], [-100, 50]];
    const ring = outerRing({ kind: "polygon", w: 200, d: 100, points: L });
    expect(dragEdgePreservingArea(ring, 0, -10, ringArea(ring))).not.toBeNull();
  });
});
