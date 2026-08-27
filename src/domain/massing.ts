/**
 * Massing model and envelope takeoff.
 *
 * A `Mass` is one rectangular volume: footprint, floors, roof, glazing, and
 * per-facade skin. `envelopeTakeoff` turns it into the quantities the estimate
 * prices — and is the single source of truth the 3D view also draws from, so a
 * drawing and its dollars cannot disagree.
 *
 * All dimensions are feet, all areas square feet.
 */

import type { GlazingPreset, RoofKind, SkinKey } from "@/markets/types";
import { TYPE_BY_ID } from "@/markets/registry";

export type Facade = "f" | "b" | "l" | "r";
export const FACADES: Facade[] = ["f", "b", "l", "r"];

export interface Mass {
  id: string;
  name: string;
  /** Context buildings render as scenery and are excluded from every rollup. */
  context: boolean;

  // Placement
  x: number;
  z: number;
  /** Rotation about Y, degrees clockwise from north. */
  rot: number;

  // Volume
  w: number;
  d: number;
  floors: number;
  /** Floor-to-floor height. */
  fth: number;
  /** Slab elevation of the lowest floor. */
  baseElev: number;

  // Below grade
  belowGrade: boolean;
  /** Reference grade elevation at the building. */
  gradeRef: number;
  /** Per-facade grade override; null means flat at gradeRef. */
  grades: Record<Facade, number> | null;

  // Roof
  roof: RoofKind;
  /** Rise per 12 for pitched roofs. */
  pitch: number;
  /** Ridge runs along width (x) or depth (z). */
  ridge: "w" | "d";

  // Glazing
  glz: GlazingPreset;
  /** Strip glazing band height. */
  glassH: number;
  /** Sill height above floor. */
  sill: number;
  /** Percent of facade length glazed. */
  cov: number;
  winW: number;
  winH: number;
  /** Punched window spacing on center. */
  oc: number;
  glzFloors: "all" | "ground";
  sides: Record<Facade, boolean>;

  // Skin
  skin: SkinKey;
  /** Per-facade override; null falls back to `skin`. */
  skins: Record<Facade, SkinKey | null>;

  // Program
  /** Unit catalog ref -> count. */
  program: Record<string, number>;
  /** Net-to-gross override; null uses the building type default. */
  grossing: number | null;
  /** Exit travel limit override, feet. */
  travel: number | null;
  stairOverride: number | null;
  elevOverride: number | null;

  /** Building type this mass is programmed against. */
  typeId: string;
}

let massSeq = 1;
export const resetMassSeq = (n = 1) => {
  massSeq = n;
};

export function makeMass(over: Partial<Mass> = {}): Mass {
  const id = over.id ?? `m${massSeq++}`;
  return {
    id,
    name: over.name ?? `Mass ${id.replace(/^m/, "")}`,
    context: false,
    x: 0,
    z: 0,
    rot: 0,
    w: 160,
    d: 66,
    floors: 3,
    fth: 10.5,
    baseElev: 0,
    belowGrade: false,
    gradeRef: 0,
    grades: null,
    roof: "flat",
    pitch: 6,
    ridge: "w",
    glz: "punched",
    glassH: 5,
    sill: 3,
    cov: 32,
    winW: 3,
    winH: 5,
    oc: 12,
    glzFloors: "all",
    sides: { f: true, b: true, l: true, r: true },
    skin: "fiber_cement",
    skins: { f: null, b: null, l: null, r: null },
    program: {},
    grossing: null,
    travel: null,
    stairOverride: null,
    elevOverride: null,
    typeId: "mf_wrap",
    ...over,
  };
}

/**
 * A mass seeded from a building type's planning defaults.
 *
 * This is how the app creates massing: picking a market and type sets the
 * footprint, floor count, floor-to-floor, glazing strategy, skin, and roof, so
 * the first thing you see already looks like the type you chose.
 */
export function makeMassForType(typeId: string, over: Partial<Mass> = {}): Mass {
  const type = TYPE_BY_ID[typeId];
  if (!type) return makeMass({ ...over, typeId });
  const d = type.defaults;
  return makeMass({
    typeId,
    name: type.label,
    w: d.footprint.w,
    d: d.footprint.d,
    floors: d.floors,
    fth: d.floorToFloor,
    glz: d.glazing,
    cov: d.glazingCoverage,
    skin: d.skin,
    roof: d.roof,
    // A below-grade type is cut into the site by definition, so the grade
    // reference starts at the top of the structure rather than at the slab.
    belowGrade: Boolean(d.belowGrade),
    gradeRef: d.belowGrade ? d.floors * d.floorToFloor : 0,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Glazed band height and sill for a mass, clamped to the floor height. */
export function glassBand(m: Mass): { bandH: number; sill: number } {
  if (m.glz === "full") return { bandH: m.fth, sill: 0 };
  const sill = Math.max(0, Math.min(m.sill || 0, m.fth - 0.5));
  const raw = m.glz === "punched" ? m.winH || 0 : m.glassH || 0;
  return { bandH: Math.max(0, Math.min(raw, m.fth - sill)), sill };
}

/**
 * Punched window layout along a facade run.
 *
 * `coverage` is the fraction of the facade length that ends up as glass, and
 * the windows are spread evenly across the WHOLE run to achieve it. Treating
 * coverage as a shortened run instead would bunch every window into the middle
 * of the elevation and leave the ends blank, which is not what any building
 * does and not what the takeoff assumed.
 *
 * `oc` acts as a maximum spacing: it can add windows beyond what coverage asks
 * for, but never pulls them into a huddle.
 */
export function punchedLayout(len: number, winW: number, oc: number, coverage = 1) {
  const usable = Math.max(0, len - 2); // hold a corner return at each end
  if (usable < winW || winW <= 0) return { n: 0, pitch: 0, start: 0 };

  const cov = Math.max(0, Math.min(1, coverage));
  const byCoverage = Math.floor((len * cov) / winW);
  const byMaxSpacing = oc > 0 ? Math.floor(usable / Math.max(winW + 0.5, oc)) + 1 : 0;
  const n = Math.max(0, Math.min(Math.max(byCoverage, byMaxSpacing), Math.floor(usable / (winW + 0.5))));
  if (n <= 0) return { n: 0, pitch: 0, start: 0 };
  if (n === 1) return { n: 1, pitch: 0, start: 0 };

  // Even bays across the usable run, windows centred in each bay.
  const pitch = (usable - winW) / (n - 1);
  return { n, pitch, start: -(usable - winW) / 2 };
}

/** Resolve the skin actually used on a facade. */
export const skinOf = (m: Mass, side: Facade): SkinKey => m.skins?.[side] ?? m.skin;

export const wallHeight = (m: Mass) => m.floors * m.fth;

export const footprint = (m: Mass) => m.w * m.d;

export const grossArea = (m: Mass) => footprint(m) * m.floors;

/** Extra roof rise for a pitched roof, and the gable end wall area. */
function roofGeometry(m: Mass) {
  const across = m.ridge === "w" ? m.d : m.w;
  const rise = (across / 2) * ((m.pitch || 0) / 12);
  const gableWall = m.roof === "gable" ? across * rise : 0; // two triangular ends
  const slopeFactor = Math.hypot(across / 2, rise) / (across / 2 || 1);
  return { across, rise, gableWall, slopeFactor };
}

// ---------------------------------------------------------------------------
// Envelope takeoff
// ---------------------------------------------------------------------------

export interface EnvelopeTakeoff {
  /** Gross wall area including gable ends. */
  grossWall: number;
  glass: number;
  /** Glass split by glazing type, keyed to rate keys. */
  glassByType: Partial<Record<"punched" | "strip" | "curtain", number>>;
  opaque: number;
  /** Opaque wall area by skin, keyed by skin id. */
  opaqueBySkin: Record<string, number>;
  roofFlat: number;
  roofPitched: number;
}

export function envelopeTakeoff(m: Mass): EnvelopeTakeoff {
  const h = wallHeight(m);
  const { gableWall, slopeFactor } = roofGeometry(m);
  const grossWall = 2 * (m.w + m.d) * h + gableWall;

  const glazingOn = m.glz !== "none";
  const { bandH } = glassBand(m);
  const glazedFloors = m.glzFloors === "ground" ? 1 : m.floors;
  const coverage = (m.cov ?? 100) / 100;

  const glassKey = m.glz === "full" ? "curtain" : (m.glz as "punched" | "strip");
  const glassByType: EnvelopeTakeoff["glassByType"] = {};
  const opaqueBySkin: Record<string, number> = {};
  let glass = 0;

  for (const side of FACADES) {
    const len = side === "f" || side === "b" ? m.w : m.d;
    const sideGross = len * h + (isGableSide(m, side) ? gableWall / 2 : 0);

    let sideGlass = 0;
    if (glazingOn && m.sides[side]) {
      if (m.glz === "punched") {
        const { n } = punchedLayout(len, m.winW, m.oc, coverage);
        sideGlass = n * m.winW * bandH * glazedFloors;
      } else {
        sideGlass = len * coverage * bandH * glazedFloors;
      }
      // Glass can never exceed the wall it sits in.
      sideGlass = Math.min(sideGlass, sideGross);
    }

    glass += sideGlass;
    if (sideGlass > 0) glassByType[glassKey] = (glassByType[glassKey] ?? 0) + sideGlass;

    const skin = skinOf(m, side);
    opaqueBySkin[skin] = (opaqueBySkin[skin] ?? 0) + Math.max(0, sideGross - sideGlass);
  }

  const fp = footprint(m);
  const roofFlat = m.roof === "flat" ? fp : 0;
  const roofPitched = m.roof === "flat" ? 0 : fp * slopeFactor;

  return {
    grossWall,
    glass,
    glassByType,
    opaque: Object.values(opaqueBySkin).reduce((a, b) => a + b, 0),
    opaqueBySkin,
    roofFlat,
    roofPitched,
  };
}

const isGableSide = (m: Mass, side: Facade) =>
  m.roof === "gable" && (m.ridge === "w" ? side === "l" || side === "r" : side === "f" || side === "b");

// ---------------------------------------------------------------------------
// Below grade
// ---------------------------------------------------------------------------

export interface BelowGradeTakeoff {
  /** Buried foundation/retaining wall area. */
  buriedWall: number;
  exposedWall: number;
  excavationCY: number;
  /** Basement slab area, when there is a real cut. */
  slabBelow: number;
  cutDepth: number;
  averageGrade: number;
}

export function belowGradeTakeoff(m: Mass): BelowGradeTakeoff {
  const h = wallHeight(m);
  const base = m.baseElev || 0;
  const top = base + h;
  const sides: [Facade, number][] = [
    ["f", m.w],
    ["b", m.w],
    ["l", m.d],
    ["r", m.d],
  ];

  let buriedWall = 0;
  let exposedWall = 0;
  let sumGrade = 0;

  for (const [side, len] of sides) {
    const grade = m.grades?.[side] ?? m.gradeRef ?? 0;
    sumGrade += grade;
    const buriedH = Math.max(0, Math.min(grade, top) - base);
    buriedWall += len * buriedH;
    exposedWall += len * Math.max(0, h - buriedH);
  }

  const averageGrade = sumGrade / 4;
  const cutDepth = Math.max(0, averageGrade - base);
  const fp = footprint(m);

  return {
    buriedWall: m.belowGrade ? buriedWall : 0,
    exposedWall,
    // 15% over-excavation for working room.
    excavationCY: m.belowGrade ? (fp * cutDepth * 1.15) / 27 : 0,
    slabBelow: m.belowGrade && cutDepth > 0.5 ? fp : 0,
    cutDepth,
    averageGrade,
  };
}

// ---------------------------------------------------------------------------
// Compass
// ---------------------------------------------------------------------------

const COMPASS_8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** Bearing of a facade in degrees clockwise from north. */
export function facadeBearing(side: Facade, rotDeg: number): number {
  const base = { f: 0, b: 180, l: 270, r: 90 }[side];
  return ((base + rotDeg) % 360 + 360) % 360;
}

export const facadeCardinal = (side: Facade, rotDeg: number): string =>
  COMPASS_8[Math.round(facadeBearing(side, rotDeg) / 45) % 8];
