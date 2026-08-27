/**
 * Sizing a footprint.
 *
 * Depth used to be pinned to the type default, so every extra square foot of
 * program went into LENGTH. A 72,000 SF medical office came out 393ft long and
 * 90ft deep, and once its L-plan took half that depth for the notch, the wings
 * were 45ft deep across five storeys — a corridor with a view, not a building.
 */

import { describe, expect, it } from "vitest";
import { fitFootprint, seedProgramForType } from "../program";
import { composeFootprint, defaultShape, minLimbDepth, footprintArea } from "../footprint";
import { BUILDING_TYPES, TYPE_BY_ID } from "@/markets/registry";

const fitFor = (typeId: string, capacity: number, floors?: number) => {
  const type = TYPE_BY_ID[typeId];
  const seeded = seedProgramForType(typeId, capacity);
  const f = floors ?? type.defaults.floors;
  const { w, d } = fitFootprint(seeded.netArea, typeId, f);
  const plan = composeFootprint(defaultShape(type.plan ?? "rect"), w, d);
  return { w, d, floors: f, limb: minLimbDepth(plan), plate: footprintArea(plan), type };
};

describe("depth grows with the program", () => {
  it("does not answer a bigger program with length alone", () => {
    const small = fitFor("hc_mob", 30_000);
    const large = fitFor("hc_mob", 120_000);
    expect(large.w).toBeGreaterThan(small.w);
    expect(large.d).toBeGreaterThan(small.d);
  });

  it("gives an L-plan medical office wings it could actually use", () => {
    // The case that started this: 72,000 SF over five floors.
    const fit = fitFor("hc_mob", 72_000, 5);
    expect(fit.limb).toBeGreaterThan(60);
    expect(fit.w / fit.d).toBeLessThan(3);
  });

  it("keeps every type's limbs deep enough to be a floor plate", () => {
    for (const type of BUILDING_TYPES) {
      const capacity = type.capacityUom === "SF" ? 60_000 : 120;
      const fit = fitFor(type.id, capacity);
      // Unless the box has already been squared up, in which case the program
      // is simply too small to give this type its full plate.
      const squared = Math.abs(fit.w - fit.d) <= 2;
      if (squared) continue;
      expect(fit.limb, `${type.id} limb ${fit.limb.toFixed(0)}ft`)
        .toBeGreaterThanOrEqual(type.defaults.footprint.d - 1);
    }
  });

  it("never returns a box deeper than it is wide", () => {
    for (const type of BUILDING_TYPES) {
      for (const capacity of [5_000, 60_000, 400_000]) {
        const fit = fitFor(type.id, type.capacityUom === "SF" ? capacity : capacity / 500);
        expect(fit.d, `${type.id} at ${capacity}`).toBeLessThanOrEqual(fit.w + 1);
      }
    }
  });
});

describe("each type keeps its own character", () => {
  it("holds a linear type linear rather than squaring everything up", () => {
    // A townhome block is a 5:1 bar and a surgery centre is 1.4:1. Both right.
    const bar = fitFor("mf_townhome", 60_000);
    const squat = fitFor("hc_asc", 60_000);
    expect(bar.w / bar.d).toBeGreaterThan(squat.w / squat.d * 2);
  });

  it("scales a rectangular type along its own default proportion", () => {
    for (const id of ["mf_townhome", "in_warehouse", "hc_ed", "he_library"]) {
      const type = TYPE_BY_ID[id];
      const fit = fitFor(id, type.capacityUom === "SF" ? 60_000 : 120);
      if (Math.abs(fit.w - fit.d) <= 2) continue; // squared up; nothing to compare
      const intended = type.defaults.footprint.w / type.defaults.footprint.d;
      expect(fit.w / fit.d, id).toBeCloseTo(intended, 0);
    }
  });

  it("is never shallower than the type's own plate depth", () => {
    for (const type of BUILDING_TYPES) {
      const fit = fitFor(type.id, type.capacityUom === "SF" ? 60_000 : 120);
      const squared = Math.abs(fit.w - fit.d) <= 2;
      if (squared) continue;
      expect(fit.d, type.id).toBeGreaterThanOrEqual(type.defaults.footprint.d - 1);
    }
  });
});

describe("a plan the user drew", () => {
  it("is left at the proportions they chose", () => {
    // A hand-drawn polygon has no arm fractions to reason about and, more to
    // the point, someone chose it. The fitter sizes the box and stops.
    const seeded = seedProgramForType("hc_mob", 72_000);
    const drawn = fitFootprint(seeded.netArea, "hc_mob", 5, 2.6, {
      kind: "polygon",
      points: [[-150, -40], [150, -40], [150, 40], [-150, 40]],
    });
    const preset = fitFootprint(seeded.netArea, "hc_mob", 5, 2.6, defaultShape("L"));
    // The L is deepened to give its wings a plate; the polygon is not.
    expect(drawn.d).toBeLessThan(preset.d);
  });
});

describe("the program still fits", () => {
  it("holds what it was asked to hold, whatever the plan shape", () => {
    for (const type of BUILDING_TYPES) {
      const capacity = type.capacityUom === "SF" ? 60_000 : 120;
      const fit = fitFor(type.id, capacity);
      const seeded = seedProgramForType(type.id, capacity);
      const needed = seeded.netArea * type.defaults.grossing;
      const provided = fit.plate * fit.floors;
      expect(provided, `${type.id}: ${provided.toFixed(0)} vs ${needed.toFixed(0)}`)
        .toBeGreaterThan(needed * 0.9);
    }
  });
});
