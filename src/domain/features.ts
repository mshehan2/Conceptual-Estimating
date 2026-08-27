/**
 * Architectural features.
 *
 * The moves that make a building read as designed rather than extruded: an
 * entry canopy, a porte cochere, a projecting bay, a glazed lobby volume,
 * sunshades, a rooftop screen, a cornice.
 *
 * Every feature does two jobs at once, and that is the whole point. It emits
 * geometry for the renderer AND quantities for the estimate, from the same
 * parameters. A canopy you can see is a canopy that costs money, and the two
 * can never drift apart because there is only one canopy.
 *
 * This is also what makes the AI design pass honest: a generated image can
 * suggest a canopy, but the suggestion has to be adopted into one of these
 * before it reaches a number. Nothing is ever priced from pixels.
 */

import type { Cardinal, FacadeSegment } from "./footprint";

export type FeatureKind =
  | "canopy"
  | "porte_cochere"
  | "bay"
  | "lobby"
  | "sunshade"
  | "roof_screen"
  | "cornice";

export interface FeatureBase {
  id: string;
  kind: FeatureKind;
  /** Facade segment index this attaches to. -1 means the whole building. */
  segment: number;
  /** Centre position along the segment, 0..1. */
  along: number;
  /** Suppress without deleting, so an option can be toggled in a comparison. */
  disabled?: boolean;
}

/** A flat entry canopy projecting from the facade. */
export interface CanopyFeature extends FeatureBase {
  kind: "canopy";
  /** Length along the facade, feet. */
  width: number;
  /** Projection out from the facade, feet. */
  projection: number;
  /** Underside height above the building base, feet. */
  height: number;
  support: "cantilever" | "column" | "suspended";
}

/** A drive-through canopy at the entrance — the arrival move on an MOB. */
export interface PorteCochereFeature extends FeatureBase {
  kind: "porte_cochere";
  width: number;
  projection: number;
  height: number;
  /** Columns down the outer edge. */
  columns: number;
}

/** A projecting bay running up the elevation. */
export interface BayFeature extends FeatureBase {
  kind: "bay";
  width: number;
  projection: number;
  /** First floor the bay starts at, 0-based. */
  fromFloor: number;
  /** Last floor, inclusive. */
  toFloor: number;
  glazed: boolean;
}

/** A distinct, taller, fully glazed entrance volume. */
export interface LobbyFeature extends FeatureBase {
  kind: "lobby";
  width: number;
  projection: number;
  /** Height in floors, which may exceed the floor it sits on. */
  floors: number;
}

/** Horizontal shading over a glazed band. */
export interface SunshadeFeature extends FeatureBase {
  kind: "sunshade";
  /** Fraction of the segment length covered, 0..1. */
  coverage: number;
  projection: number;
  /** Which floors carry shades; empty means all. */
  floors: number[];
}

/** A parapet-height screen hiding rooftop plant. */
export interface RoofScreenFeature extends FeatureBase {
  kind: "roof_screen";
  height: number;
  /** Fraction of the roof perimeter enclosed, 0..1. */
  coverage: number;
  material: "louver" | "panel" | "mesh";
}

/** A projecting band at the parapet. */
export interface CorniceFeature extends FeatureBase {
  kind: "cornice";
  depth: number;
  projection: number;
}

export type Feature =
  | CanopyFeature
  | PorteCochereFeature
  | BayFeature
  | LobbyFeature
  | SunshadeFeature
  | RoofScreenFeature
  | CorniceFeature;

// ---------------------------------------------------------------------------

let featureSeq = 1;
export const resetFeatureSeq = (n = 1) => {
  featureSeq = n;
};
const nextId = () => `ft${featureSeq++}`;

/** Sensible defaults per kind, so adding one produces something plausible. */
export function makeFeature(kind: FeatureKind, over: Partial<Feature> = {}): Feature {
  const base = { id: nextId(), kind, segment: 0, along: 0.5 };
  switch (kind) {
    case "canopy":
      return { ...base, kind, width: 24, projection: 8, height: 12, support: "cantilever", ...over } as CanopyFeature;
    case "porte_cochere":
      return { ...base, kind, width: 40, projection: 24, height: 15, columns: 2, ...over } as PorteCochereFeature;
    case "bay":
      return { ...base, kind, width: 16, projection: 3, fromFloor: 0, toFloor: 99, glazed: true, ...over } as BayFeature;
    case "lobby":
      return { ...base, kind, width: 40, projection: 6, floors: 2, ...over } as LobbyFeature;
    case "sunshade":
      return { ...base, kind, segment: -1, coverage: 1, projection: 3, floors: [], ...over } as SunshadeFeature;
    case "roof_screen":
      return { ...base, kind, segment: -1, height: 8, coverage: 0.6, material: "louver", ...over } as RoofScreenFeature;
    case "cornice":
      return { ...base, kind, segment: -1, depth: 2, projection: 1.5, ...over } as CorniceFeature;
  }
}

export const FEATURE_LABELS: Record<FeatureKind, string> = {
  canopy: "Entry canopy",
  porte_cochere: "Porte cochere",
  bay: "Projecting bay",
  lobby: "Glazed lobby volume",
  sunshade: "Sunshades",
  roof_screen: "Rooftop screen",
  cornice: "Cornice band",
};

/** One line describing what a feature does to the number. */
export const FEATURE_COST_NOTES: Record<FeatureKind, string> = {
  canopy: "Priced per SF of canopy; column support costs more than a cantilever.",
  porte_cochere: "Priced per SF of cover, plus each column.",
  bay: "Adds envelope area on three sides and removes the flat wall behind it.",
  lobby: "Storefront glazing at a premium rate, plus the extra volume's structure.",
  sunshade: "Priced per linear foot of shade.",
  roof_screen: "Priced per SF of screen, by material.",
  cornice: "Priced per linear foot.",
};

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

export interface FeatureQuantities {
  /** rate key -> quantity. */
  quantities: Record<string, number>;
  /**
   * Net change to the flat wall area the envelope takeoff measured, SF.
   * Positive adds wall, negative removes it. A bay adds its returns and hides
   * the wall behind; a lobby volume replaces opaque wall with storefront.
   */
  wallDelta: number;
  /** Opaque wall replaced by glazing, SF. */
  glazingDelta: number;
}

export interface FeatureContext {
  /** Segments of the mass this feature belongs to. */
  segments: FacadeSegment[];
  floors: number;
  floorToFloor: number;
  /** Roof perimeter, feet. */
  roofPerimeter: number;
}

const add = (q: Record<string, number>, key: string, amount: number) => {
  if (!amount) return;
  q[key] = (q[key] ?? 0) + amount;
};

/** Quantities and envelope adjustments produced by one feature. */
export function featureTakeoff(feature: Feature, ctx: FeatureContext): FeatureQuantities {
  const quantities: Record<string, number> = {};
  let wallDelta = 0;
  let glazingDelta = 0;

  if (feature.disabled) return { quantities, wallDelta, glazingDelta };

  const segment = feature.segment >= 0 ? ctx.segments[feature.segment] : undefined;
  const segmentLength = segment?.length ?? ctx.roofPerimeter;

  switch (feature.kind) {
    case "canopy": {
      // A canopy cannot be wider than the wall it hangs on.
      const width = Math.min(feature.width, segmentLength);
      const area = width * feature.projection;
      add(quantities, feature.support === "cantilever" ? "canopy_cantilever" : "canopy_supported", area);
      if (feature.support === "column") add(quantities, "canopy_column", Math.max(2, Math.round(width / 14)));
      break;
    }

    case "porte_cochere": {
      const width = Math.min(feature.width, segmentLength);
      add(quantities, "porte_cochere", width * feature.projection);
      add(quantities, "canopy_column", Math.max(2, feature.columns));
      // The drive surface underneath is paving, not building.
      add(quantities, "site_parking", width * feature.projection);
      break;
    }

    case "bay": {
      const width = Math.min(feature.width, segmentLength);
      const top = Math.min(feature.toFloor, ctx.floors - 1);
      const floorCount = Math.max(0, top - feature.fromFloor + 1);
      if (floorCount <= 0) break;
      const height = floorCount * ctx.floorToFloor;

      // Two returns plus the new front face; the original flat wall behind is
      // no longer exterior, so it comes back out of the envelope.
      const returns = 2 * feature.projection * height;
      const front = width * height;
      wallDelta += returns + front - width * height;
      if (feature.glazed) glazingDelta += front;

      add(quantities, "bay_structure", width * feature.projection * floorCount);
      break;
    }

    case "lobby": {
      const width = Math.min(feature.width, segmentLength);
      const height = feature.floors * ctx.floorToFloor;
      const front = width * height;
      const returns = 2 * feature.projection * height;

      // The volume's own envelope replaces flat wall; its face is storefront.
      wallDelta += returns;
      glazingDelta += front;
      add(quantities, "storefront", front + returns * 0.5);
      add(quantities, "elevated_floor", width * feature.projection);
      add(quantities, "roof", width * feature.projection);
      break;
    }

    case "sunshade": {
      const runs = feature.floors.length > 0 ? feature.floors.length : ctx.floors;
      const length = segmentLength * Math.max(0, Math.min(1, feature.coverage)) * runs;
      add(quantities, "sunshade", length);
      break;
    }

    case "roof_screen": {
      const length = ctx.roofPerimeter * Math.max(0, Math.min(1, feature.coverage));
      add(quantities, `roof_screen_${feature.material}`, length * feature.height);
      break;
    }

    case "cornice": {
      add(quantities, "cornice", ctx.roofPerimeter);
      break;
    }
  }

  return { quantities, wallDelta, glazingDelta };
}

/** Roll every feature on a mass into one set of adjustments. */
export function featuresTakeoff(features: Feature[], ctx: FeatureContext): FeatureQuantities {
  const quantities: Record<string, number> = {};
  let wallDelta = 0;
  let glazingDelta = 0;

  for (const feature of features) {
    const result = featureTakeoff(feature, ctx);
    for (const [key, value] of Object.entries(result.quantities)) add(quantities, key, value);
    wallDelta += result.wallDelta;
    glazingDelta += result.glazingDelta;
  }

  return { quantities, wallDelta, glazingDelta };
}

/** Cardinal a feature faces, for describing it to an image model. */
export const featureCardinal = (feature: Feature, segments: FacadeSegment[]): Cardinal | null =>
  feature.segment >= 0 ? (segments[feature.segment]?.cardinal ?? null) : null;
