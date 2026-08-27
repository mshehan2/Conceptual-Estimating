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
import {
  composeFootprint,
  defaultShape,
  facadeSegments,
  footprintArea,
  footprintPerimeter,
  insetRing,
  outerRing,
  ringArea,
  type FacadeSegment,
  type Footprint,
  type FootprintShape,
} from "./footprint";
import { featuresTakeoff, makeFeature, type Feature, type FeatureKind } from "./features";

export type Facade = "f" | "b" | "l" | "r";

/** Roof assembly options, priced as a swap on the roof plate. */
export type RoofAssembly = "membrane" | "green_extensive" | "green_intensive" | "ballasted" | "pv_ready";

/** Rate key each roof assembly prices against. */
export const ROOF_ASSEMBLY_KEY: Record<RoofAssembly, string> = {
  membrane: "roof",
  green_extensive: "roof_green_extensive",
  green_intensive: "roof_green_intensive",
  ballasted: "roof_ballasted",
  pv_ready: "roof_pv_ready",
};

export const ROOF_ASSEMBLY_LABELS: Record<RoofAssembly, string> = {
  membrane: "Membrane (TPO/EPDM)",
  green_extensive: "Green roof - extensive",
  green_intensive: "Green roof - intensive",
  ballasted: "Ballasted membrane",
  pv_ready: "Membrane, PV-ready",
};

/** The skin in effect on a given floor, honouring vertical banding. */
export function skinAtFloor(m: Mass, side: Facade, floor: number): SkinKey {
  const bands = (m.skinBands ?? []).filter((b) => floor >= b.fromFloor).sort((a, b) => b.fromFloor - a.fromFloor);
  return bands[0]?.skin ?? skinOf(m, side);
}
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
  /** Bounding width of the footprint. */
  w: number;
  /** Bounding depth of the footprint. */
  d: number;
  /**
   * Plan shape within the bounding box. Presets and hand-drawn geometry are the
   * same type; everything downstream resolves both to a polygon.
   */
  shape: FootprintShape;
  /** Upper-floor setbacks, as an inset in feet from a given floor upward. */
  stepbacks: { atFloor: number; inset: number }[];
  /** Canopies, bays, lobby volumes and the rest. Drawn and priced together. */
  features: Feature[];
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
  /**
   * Roof assembly. Swapped on the roof plate rather than added to it, so
   * choosing a green roof replaces the membrane rate instead of stacking on it.
   */
  roofAssembly: RoofAssembly;
  /** Parapet height, feet. Changes the silhouette and the wall area up top. */
  parapet: number;
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
  /**
   * Vertical material banding: a different cladding from a given floor upward.
   * A brick base with metal panel above is the most common composed elevation
   * there is, and one skin per facade cannot express it.
   */
  skinBands: { fromFloor: number; skin: SkinKey }[];

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
    shape: { kind: "rect" },
    stepbacks: [],
    features: [],
    floors: 3,
    fth: 10.5,
    baseElev: 0,
    belowGrade: false,
    gradeRef: 0,
    grades: null,
    roof: "flat",
    roofAssembly: "membrane",
    parapet: 3.5,
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
    skinBands: [],
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
    shape: defaultShape(type.plan ?? "rect"),
    // The type's characteristic moves, placed on the entrance elevation.
    features: seedFeaturesFor(typeId),
    floors: d.floors,
    fth: d.floorToFloor,
    glz: d.glazing,
    cov: d.glazingCoverage,
    skin: d.skin,
    roof: d.roof,
    roofAssembly: d.roofAssembly ?? "membrane",
    parapet: d.parapet ?? 3.5,
    skinBands: d.skinBands ? [...d.skinBands] : [],
    // A below-grade type is cut into the site by definition, so the grade
    // reference starts at the top of the structure rather than at the slab.
    belowGrade: Boolean(d.belowGrade),
    gradeRef: d.belowGrade ? d.floors * d.floorToFloor : 0,
    ...over,
  });
}

/**
 * The features a building type characteristically has.
 *
 * Placed on the longest wall facing south or east, which is where an entrance
 * usually goes and, more practically, guarantees the arrival move is visible
 * from the default camera rather than hidden round the back.
 */
export function seedFeaturesFor(typeId: string): Feature[] {
  const type = TYPE_BY_ID[typeId];
  if (!type?.features?.length) return [];

  const probe = makeMass({
    typeId,
    w: type.defaults.footprint.w,
    d: type.defaults.footprint.d,
    shape: defaultShape(type.plan ?? "rect"),
  });
  const segments = massSegments(probe);
  const entrance =
    segments
      .filter((s) => !s.courtFacing)
      .sort((a, b) => {
        const facing = (s: typeof a) => (s.cardinal === "S" ? 2 : s.cardinal === "E" ? 1 : 0);
        return facing(b) - facing(a) || b.length - a.length;
      })[0] ?? segments[0];

  // Spread them along the wall. Every seeded feature defaulting to the middle
  // buries the canopy inside the lobby volume, which is both wrong and
  // invisible — the two most expensive ways for a feature to be broken.
  const hasEntranceVolume = type.features.some((f) => f.kind === "lobby" || f.kind === "porte_cochere");
  const positionFor = (kind: FeatureKind): number => {
    switch (kind) {
      case "lobby":
      case "porte_cochere":
        return 0.5;
      case "canopy":
        // A secondary entrance where the main arrival is already taken.
        return hasEntranceVolume ? 0.19 : 0.5;
      case "bay":
        return 0.8;
      default:
        return 0.5;
    }
  };

  return type.features.map((seed) =>
    makeFeature(seed.kind, {
      segment: entrance?.index ?? 0,
      along: positionFor(seed.kind),
      ...(seed.params ?? {}),
    } as Partial<Feature>),
  );
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

/** The mass's plan as a complete footprint: shape parameters plus its size. */
export const massFootprint = (m: Mass): Footprint => composeFootprint(m.shape ?? { kind: "rect" }, m.w, m.d);

/** Ground floor plate area. Named for what it is, since Footprint is a type. */
export const footprint = (m: Mass): number => footprintArea(massFootprint(m));

/** Walls of the ground floor, including any facing an enclosed court. */
export const massSegments = (m: Mass): FacadeSegment[] => facadeSegments(massFootprint(m));

/**
 * Per-floor plate areas, honouring setbacks.
 *
 * A stepback insets the plan from a given floor upward, so upper floors are
 * genuinely smaller: the area, the envelope and the roof all follow, which is
 * the whole reason to draw one.
 */
export function floorPlates(m: Mass): { floor: number; area: number; inset: number }[] {
  const plan = massFootprint(m);
  const base = outerRing(plan);
  // A court is a hole in every plate, so it is measured once and removed from
  // each — including from an inset plate, since a setback shrinks the outside
  // edge and leaves the court where it is.
  const courtArea = ringArea(base) - footprintArea(plan);
  const plates: { floor: number; area: number; inset: number }[] = [];

  for (let floor = 0; floor < m.floors; floor++) {
    const inset = (m.stepbacks ?? [])
      .filter((s) => floor >= s.atFloor)
      .reduce((a, s) => a + Math.max(0, s.inset), 0);
    const ring = inset > 0 ? insetRing(base, inset) : base;
    // A court does not shrink with a setback, so it is removed at full size.
    plates.push({ floor, area: Math.max(0, ringArea(ring) - courtArea), inset });
  }

  // Voids cut through the plates: an atrium, a recessed balcony, a loggia.
  // These are the features that make a building smaller, and leaving them out
  // would overstate both the area and every fee taken as a percentage of it.
  const voids = plateVoidArea(m);
  if (voids > 0 && plates.length > 0) {
    const perFloor = voids / plates.length;
    for (const plate of plates) plate.area = Math.max(0, plate.area - perFloor);
  }

  return plates;
}

export const grossArea = (m: Mass): number => floorPlates(m).reduce((a, p) => a + p.area, 0);

/** Total floor plate removed by voids, SF. Always reported as a positive area. */
export function plateVoidArea(m: Mass): number {
  if (!(m.features ?? []).length) return 0;
  const plan = massFootprint(m);
  const { plateDelta } = featuresTakeoff(m.features ?? [], {
    segments: facadeSegments(plan),
    floors: m.floors,
    floorToFloor: m.fth,
    roofPerimeter: footprintPerimeter(plan),
  });
  return Math.max(0, -plateDelta);
}

/** Roof area: the top plate, plus any lower roof exposed by a setback. */
export function roofPlates(m: Mass): number {
  const plates = floorPlates(m);
  if (!plates.length) return 0;
  let total = plates[plates.length - 1].area;
  // Where a floor is smaller than the one below, the difference becomes roof.
  for (let i = 1; i < plates.length; i++) {
    total += Math.max(0, plates[i - 1].area - plates[i].area);
  }
  return total;
}

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
  const plan = massFootprint(m);
  const segments = facadeSegments(plan);

  const glazingOn = m.glz !== "none";
  const { bandH } = glassBand(m);
  const glazedFloors = m.glzFloors === "ground" ? 1 : m.floors;
  const coverage = (m.cov ?? 100) / 100;

  const glassKey = m.glz === "full" ? "curtain" : (m.glz as "punched" | "strip");
  const glassByType: EnvelopeTakeoff["glassByType"] = {};
  const opaqueBySkin: Record<string, number> = {};
  let glass = 0;
  let grossWall = 0;

  // Walk the real walls rather than four notional sides, so an L, a courtyard
  // and a hand-drawn plan are all measured by the same code. A cardinal
  // direction still selects which walls a setting applies to, which is how
  // per-side glazing and cladding keep working on any shape.
  for (const segment of segments) {
    const side = segment.side;
    const gableShare = isGableSide(m, side) ? gableWall / 2 / Math.max(1, countSide(segments, side)) : 0;
    const segmentGross = segment.length * h + gableShare;
    grossWall += segmentGross;

    let segmentGlass = 0;
    if (glazingOn && m.sides[side]) {
      if (m.glz === "punched") {
        const { n } = punchedLayout(segment.length, m.winW, m.oc, coverage);
        segmentGlass = n * m.winW * bandH * glazedFloors;
      } else {
        segmentGlass = segment.length * coverage * bandH * glazedFloors;
      }
      segmentGlass = Math.min(segmentGlass, segmentGross);
    }

    glass += segmentGlass;
    if (segmentGlass > 0) glassByType[glassKey] = (glassByType[glassKey] ?? 0) + segmentGlass;

    // Split the opaque area floor by floor so vertical banding is measured as
    // the separate materials it is, rather than averaged into one skin.
    const opaqueTotal = Math.max(0, segmentGross - segmentGlass);
    const banded = (m.skinBands ?? []).length > 0;
    if (!banded) {
      const skin = skinOf(m, side);
      opaqueBySkin[skin] = (opaqueBySkin[skin] ?? 0) + opaqueTotal;
    } else {
      for (let floor = 0; floor < m.floors; floor++) {
        const skin = skinAtFloor(m, side, floor);
        opaqueBySkin[skin] = (opaqueBySkin[skin] ?? 0) + opaqueTotal / m.floors;
      }
    }
  }

  // Features adjust the envelope they sit on: a bay adds its returns and hides
  // the wall behind, a lobby volume swaps opaque wall for storefront.
  const adjustments = featuresTakeoff(m.features ?? [], {
    segments,
    floors: m.floors,
    floorToFloor: m.fth,
    roofPerimeter: footprintPerimeter(plan),
  });

  if (adjustments.wallDelta !== 0 || adjustments.glazingDelta !== 0) {
    const defaultSkin = m.skin;
    const opaqueAdjust = adjustments.wallDelta - adjustments.glazingDelta;
    opaqueBySkin[defaultSkin] = Math.max(0, (opaqueBySkin[defaultSkin] ?? 0) + opaqueAdjust);
    grossWall = Math.max(0, grossWall + adjustments.wallDelta);
    // Storefront is priced on its own line, so the glazing it replaces is
    // removed here rather than counted twice.
    glass = Math.max(0, glass);
  }

  const roofArea = roofPlates(m);
  const roofFlat = m.roof === "flat" ? roofArea : 0;
  const roofPitched = m.roof === "flat" ? 0 : roofArea * slopeFactor;

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

/** How many walls face a given cardinal, for splitting a gable end between them. */
const countSide = (segments: FacadeSegment[], side: Facade): number =>
  segments.reduce((a, s) => a + (s.side === side ? 1 : 0), 0);

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
  // Walk the real walls, so a courtyard's inner face and a hand-drawn plan's
  // odd edges are excavated and waterproofed like any other wall.
  const segments = massSegments(m);

  let buriedWall = 0;
  let exposedWall = 0;
  let weightedGrade = 0;
  let totalLength = 0;

  for (const segment of segments) {
    const grade = m.grades?.[segment.side] ?? m.gradeRef ?? 0;
    weightedGrade += grade * segment.length;
    totalLength += segment.length;
    const buriedH = Math.max(0, Math.min(grade, top) - base);
    buriedWall += segment.length * buriedH;
    exposedWall += segment.length * Math.max(0, h - buriedH);
  }

  // Weighted by wall length rather than a flat average of four sides: on an L
  // or a custom plan the sides are not equal, and a flat mean would misreport
  // the cut depth the excavation is priced from.
  const averageGrade = totalLength > 0 ? weightedGrade / totalLength : m.gradeRef ?? 0;
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
