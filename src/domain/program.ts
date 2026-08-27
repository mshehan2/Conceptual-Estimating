/**
 * Program, capacity, and circulation.
 *
 * Turns a mass's unit counts into net area, capacity, and the core it needs —
 * then checks whether the box the user drew can actually hold it. This is the
 * feedback loop that makes massing iteration honest: change the footprint and
 * the program either fits or it doesn't.
 */

import { COUNTABLE_CATEGORIES, UNIT_BY_REF, unitArea, type UnitDef } from "@/markets/unitCatalog";
import { TYPE_BY_ID } from "@/markets/registry";
import { grossArea, type Mass } from "./massing";
import { composeFootprint, defaultShape, footprintArea, minLimbDepth, type FootprintShape } from "./footprint";

export interface CirculationSettings {
  /** Area per egress stair, per floor. */
  stairSF: number;
  /** Area per elevator shaft, per floor. */
  elevSF: number;
  unitsPerElevator: number;
  sfPerElevator: number;
}

export const DEFAULT_CIRCULATION: CirculationSettings = {
  stairSF: 220,
  elevSF: 90,
  unitsPerElevator: 60,
  sfPerElevator: 45_000,
};

export interface CirculationResult {
  stairs: number;
  elevators: number;
  /** Total core area across all floors. */
  coreSF: number;
  /** True when the counts came from the code rules rather than an override. */
  auto: { stairs: boolean; elevators: boolean };
}

/** Stair and elevator counts from travel distance, unit count, and area. */
export function circulation(m: Mass, cs: CirculationSettings = DEFAULT_CIRCULATION): CirculationResult {
  const type = TYPE_BY_ID[m.typeId];
  const travelLimit = m.travel ?? type?.defaults.travelDistance ?? 250;
  const longest = Math.max(m.w, m.d);
  const autoStairs = Math.max(2, Math.ceil(longest / travelLimit));

  const units = totalUnits(m);
  const gsf = grossArea(m);
  const autoElevators =
    m.floors <= 1
      ? 0
      : Math.max(1, Math.ceil(Math.max(units / cs.unitsPerElevator, gsf / cs.sfPerElevator)));

  const stairs = Math.max(0, Math.round(m.stairOverride ?? autoStairs));
  const elevators = Math.max(0, Math.round(m.elevOverride ?? autoElevators));

  return {
    stairs,
    elevators,
    coreSF: (stairs * cs.stairSF + elevators * cs.elevSF) * m.floors,
    auto: { stairs: m.stairOverride == null, elevators: m.elevOverride == null },
  };
}

export const totalUnits = (m: Mass): number =>
  Object.entries(m.program).reduce((a, [ref, n]) => {
    const u = UNIT_BY_REF[ref];
    return u && COUNTABLE_CATEGORIES.has(u.category) ? a + (n || 0) : a;
  }, 0);

export const totalBeds = (m: Mass): number =>
  Object.entries(m.program).reduce((a, [ref, n]) => {
    const u = UNIT_BY_REF[ref];
    return u ? a + (n || 0) * (u.beds ?? 0) : a;
  }, 0);

/** Net program area across every entry, counted or not. */
export const netProgramArea = (m: Mass): number =>
  Object.entries(m.program).reduce((a, [ref, n]) => {
    const u = UNIT_BY_REF[ref];
    return u ? a + (n || 0) * unitArea(u) : a;
  }, 0);

/** Net-to-gross multiplier in effect for a mass. */
export function grossingFactor(m: Mass): number {
  const fromType = TYPE_BY_ID[m.typeId]?.defaults.grossing;
  return Math.max(1, m.grossing ?? fromType ?? 1.35);
}

export interface CapacityResult {
  netProgram: number;
  grossedProgram: number;
  coreSF: number;
  /** Gross area the program requires. */
  required: number;
  /** Gross area the drawn box provides. */
  available: number;
  /** Required as a percentage of available. */
  pct: number;
  over: boolean;
  /** Net program / gross area — the efficiency actually achieved. */
  efficiency: number;
}

export function capacity(m: Mass, cs: CirculationSettings = DEFAULT_CIRCULATION): CapacityResult {
  const netProgram = netProgramArea(m);
  const grossedProgram = netProgram * grossingFactor(m);
  const coreSF = circulation(m, cs).coreSF;
  const required = grossedProgram + coreSF;
  const available = grossArea(m);
  return {
    netProgram,
    grossedProgram,
    coreSF,
    required,
    available,
    pct: available > 0 ? (required / available) * 100 : 0,
    over: required > available + 0.5,
    efficiency: available > 0 ? netProgram / available : 0,
  };
}

// ---------------------------------------------------------------------------
// Seeding a program from a capacity target
// ---------------------------------------------------------------------------

export interface SeededProgram {
  program: Record<string, number>;
  /** Support space added off the type's ratios, ref -> count. */
  support: Record<string, number>;
  netArea: number;
  capacityUnits: number;
}

/**
 * Build a program from a capacity target.
 *
 * `target` is read in the type's own capacity unit: 200 apartments, 120 keys,
 * 90 beds — or, for types measured in area (an MOB, a warehouse), 40,000 net
 * square feet. Getting that reading right matters: treating an SF target as a
 * count would seed forty 25,000 SF high-bay floors.
 *
 * Counts are distributed across the type's default mix by largest remainder so
 * they are whole numbers that still sum to exactly the target, then support
 * space is layered on, scaled off the same capacity.
 */
export function seedProgramForType(typeId: string, target: number): SeededProgram {
  const type = TYPE_BY_ID[typeId];
  const program: Record<string, number> = {};
  const support: Record<string, number> = {};
  if (!type || target <= 0) return { program, support, netArea: 0, capacityUnits: 0 };

  // Area- and density-measured types: the target describes floor area or
  // occupancy, so mix shares are shares of NET AREA rather than counts.
  const DENSITY_UOMS = new Set(["SF", "STUDENT", "SEAT"]);
  if (DENSITY_UOMS.has(type.capacityUom)) {
    const netTarget =
      type.capacityUom === "SF"
        ? target
        : target * (type.gsfPerCapacity ?? 200) * type.efficiency.typical;
    for (const m of type.programMix) {
      const unit = UNIT_BY_REF[m.unitRef];
      if (!unit) continue;
      const count = Math.max(1, Math.round((m.share * netTarget) / unitArea(unit)));
      program[m.unitRef] = (program[m.unitRef] ?? 0) + count;
    }
    for (const sp of type.supportSpaces ?? []) {
      const unit = UNIT_BY_REF[sp.unitRef];
      if (!unit) continue;
      const count = Math.max(1, Math.round((sp.sfPerCapacity * target) / unitArea(unit)));
      support[sp.unitRef] = count;
      program[sp.unitRef] = (program[sp.unitRef] ?? 0) + count;
    }
    const netArea = Object.entries(program).reduce((a, [ref, n]) => {
      const u = UNIT_BY_REF[ref];
      return u ? a + n * unitArea(u) : a;
    }, 0);
    return { program, support, netArea, capacityUnits: 0 };
  }

  const targetCapacity = target;
  // Largest remainder: floor everything, then hand out what's left by remainder.
  const raw = type.programMix.map((m) => ({ ref: m.unitRef, exact: m.share * targetCapacity }));
  const floored = raw.map((r) => ({ ...r, n: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let remaining = Math.round(targetCapacity) - floored.reduce((a, r) => a + r.n, 0);
  floored.sort((a, b) => b.rem - a.rem);
  for (let i = 0; remaining > 0 && floored.length; i++, remaining--) {
    floored[i % floored.length].n += 1;
  }
  for (const r of floored) if (r.n > 0) program[r.ref] = r.n;

  // Support space: SF per capacity unit, converted to whole rooms of that type.
  for (const s of type.supportSpaces ?? []) {
    const unit = UNIT_BY_REF[s.unitRef];
    if (!unit) continue;
    const targetSF = s.sfPerCapacity * targetCapacity;
    const count = Math.max(1, Math.round(targetSF / unitArea(unit)));
    support[s.unitRef] = count;
    program[s.unitRef] = (program[s.unitRef] ?? 0) + count;
  }

  const netArea = Object.entries(program).reduce((a, [ref, n]) => {
    const u = UNIT_BY_REF[ref];
    return u ? a + n * unitArea(u) : a;
  }, 0);

  const capacityUnits = Object.entries(program).reduce((a, [ref, n]) => {
    const u = UNIT_BY_REF[ref];
    return u && COUNTABLE_CATEGORIES.has(u.category) ? a + n : a;
  }, 0);

  return { program, support, netArea, capacityUnits };
}

/**
 * Fraction of a bounding box a plan shape actually fills.
 *
 * An L fills about three quarters of its box and a courtyard rather less, so a
 * bounding box sized as though the plan were rectangular leaves the building
 * unable to hold its own program. That shows up as an over-capacity warning and
 * an inflated cost per square foot, and it is a sizing bug rather than anything
 * the design did wrong.
 */
export function shapeAreaRatio(shape: FootprintShape | undefined, w: number, d: number): number {
  if (!shape || shape.kind === "rect") return 1;
  const box = Math.max(1, w * d);
  return Math.max(0.15, Math.min(1, footprintArea(composeFootprint(shape, w, d)) / box));
}

/**
 * Footprint that would hold a program at a given floor count.
 *
 * Depth grows with the program; it is not pinned to the type default. Pinning
 * it meant every square foot of extra program went into LENGTH, so a 72,000 SF
 * medical office came out 393ft long and 90ft deep — and once the L-plan took
 * half that depth for its notch, a 45ft-deep wing on five storeys, which is a
 * corridor with a view rather than a building.
 *
 * Two things bound the box, and the type default serves both:
 *
 *   - Proportion. The type's default footprint is scaled uniformly, so depth
 *     grows with the program and each type keeps its own character. `aspect`
 *     is only the fallback for a type with no default footprint to read.
 *   - Limb depth. The type's default depth is the depth of a good floor plate
 *     for this use, so it is what the THINNEST LIMB should reach — not a
 *     number the whole box is held at. A shape's arms are fractions of the
 *     box, so a plan needs a deeper box than a rectangle to get the same
 *     usable plate out of it.
 *
 * Past square the box stops helping, and a program too small to give its type
 * a full-depth plate simply gets a square one. That is a real constraint, not
 * a bug to design around.
 */
export function fitFootprint(
  netArea: number,
  typeId: string,
  floors: number,
  aspect = 2.6,
  shape?: FootprintShape,
): { w: number; d: number } {
  const type = TYPE_BY_ID[typeId];
  const grossing = type?.defaults.grossing ?? 1.35;
  const plan = shape ?? defaultShape(type?.plan ?? "rect");
  // Grow the box by whatever the shape carves out of it, so the plan holds the
  // same program whichever shape it is drawn in.
  const fill = shapeAreaRatio(plan, type?.defaults.footprint.w ?? 100, type?.defaults.footprint.d ?? 100);
  const perFloor = Math.max(400, (netArea * grossing) / Math.max(1, floors) / fill);
  const targetDepth = type?.defaults.footprint.d ?? 66;
  const targetWidth = type?.defaults.footprint.w;

  // The type's own default footprint states the proportion it wants, so scale
  // that uniformly rather than imposing one aspect on everything. A townhome
  // block is a 5:1 bar and a surgery centre is 1.4:1, and both are right; the
  // fault was never the proportion, it was holding depth fixed so every extra
  // square foot went into length.
  const intended = targetWidth ? targetWidth / targetDepth : aspect;
  let d = Math.max(targetDepth, Math.sqrt(perFloor / Math.max(1, Math.min(6, intended))));

  // Deepen until the thinnest limb is a usable plate. A hand-drawn polygon is
  // left alone: someone chose those proportions on purpose, and the fitter has
  // no business overruling them.
  if (plan.kind !== "polygon") {
    for (let i = 0; i < 24; i++) {
      const limb = minLimbDepth(composeFootprint(plan, perFloor / d, d));
      if (limb >= targetDepth - 0.5) break;
      // Damped, because a rotated U's limb depth moves with width as well.
      d *= Math.min(1.6, targetDepth / Math.max(1, limb));
    }
  }

  // Never deeper than it is wide. Past square the box cannot help the limb.
  d = Math.min(d, Math.sqrt(perFloor));
  return { w: Math.round(perFloor / d), d: Math.round(d) };
}

/** Every unit ref present in a program, resolved. */
export const programUnits = (program: Record<string, number>): { unit: UnitDef; count: number }[] =>
  Object.entries(program)
    .map(([ref, count]) => ({ unit: UNIT_BY_REF[ref], count }))
    .filter((r): r is { unit: UnitDef; count: number } => Boolean(r.unit) && r.count > 0);
