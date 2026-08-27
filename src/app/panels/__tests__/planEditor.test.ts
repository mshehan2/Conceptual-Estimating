/**
 * Plan editor helpers.
 *
 * Parsing and snapping is where a plan editor actually goes wrong: a survey
 * pasted in the wrong winding, a coordinate list with a header row, a closed
 * ring that repeats its first point, or a vertex that lands a degree out of
 * square and looks fine on screen while being unbuildable.
 */

import { describe, expect, it } from "vitest";
import { orthoLock, parseCoordinates } from "../PlanEditor";
import { footprintArea, outerRing, signedArea, type Point } from "@/domain/footprint";

describe("coordinate import", () => {
  it("reads a plain comma-separated list", () => {
    expect(parseCoordinates("0,0\n180,0\n180,90\n0,90")).toEqual([
      [0, 0], [180, 0], [180, 90], [0, 90],
    ]);
  });

  it("accepts tabs, spaces and semicolons", () => {
    expect(parseCoordinates("0\t0\n10 0\n10;10")).toEqual([[0, 0], [10, 0], [10, 10]]);
  });

  it("skips a header row and blank lines", () => {
    expect(parseCoordinates("X, Y\n\n0, 0\n\n100, 0\n100, 60\n")).toEqual([
      [0, 0], [100, 0], [100, 60],
    ]);
  });

  it("drops the repeated closing point of a closed ring", () => {
    // Survey exports usually close the ring; the model stores it open.
    expect(parseCoordinates("0,0\n100,0\n100,60\n0,60\n0,0")).toEqual([
      [0, 0], [100, 0], [100, 60], [0, 60],
    ]);
  });

  it("ignores lines that are not a pair of numbers", () => {
    expect(parseCoordinates("0,0\nnot a point\n50\n100,50")).toEqual([[0, 0], [100, 50]]);
  });

  it("handles negative and decimal coordinates", () => {
    expect(parseCoordinates("-40.5, -20.25\n40.5, -20.25\n0, 33")).toEqual([
      [-40.5, -20.25], [40.5, -20.25], [0, 33],
    ]);
  });

  it("produces a usable footprint whichever way the survey was wound", () => {
    const ccw = parseCoordinates("0,0\n100,0\n100,60\n0,60");
    const cw = parseCoordinates("0,60\n100,60\n100,0\n0,0");
    const areaOf = (points: Point[]) => footprintArea({ kind: "polygon", w: 100, d: 60, points });

    expect(areaOf(ccw)).toBeCloseTo(6000, 4);
    expect(areaOf(cw)).toBeCloseTo(6000, 4);
    // Winding is corrected on the way in, so normals always point outward.
    expect(signedArea(outerRing({ kind: "polygon", w: 100, d: 60, points: cw }))).toBeGreaterThan(0);
  });

  it("returns nothing usable from junk, rather than a broken polygon", () => {
    expect(parseCoordinates("hello\nworld")).toHaveLength(0);
    expect(parseCoordinates("")).toHaveLength(0);
  });
});

describe("orthogonal lock", () => {
  const prev: Point = [0, 0];
  const next: Point = [100, 100];

  it("squares a near-aligned vertex to its neighbour", () => {
    expect(orthoLock([2, 50], prev, next, 5)).toEqual([0, 50]);
  });

  it("leaves a deliberately angled vertex alone", () => {
    expect(orthoLock([40, 50], prev, next, 5)).toEqual([40, 50]);
  });

  it("can square to both neighbours at once", () => {
    expect(orthoLock([98, 3], prev, next, 5)).toEqual([100, 0]);
  });

  it("respects the tolerance", () => {
    expect(orthoLock([4, 50], prev, next, 5)).toEqual([0, 50]);
    expect(orthoLock([6, 50], prev, next, 5)).toEqual([6, 50]);
  });
});
