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
  | "brise_soleil"
  | "balcony"
  | "loggia"
  | "feature_corner"
  | "atrium"
  | "connector"
  | "terrace"
  | "plaza"
  | "pergola"
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

/** Vertical fin array or deep brise-soleil over a glazed elevation. */
export interface BriseSoleilFeature extends FeatureBase {
  kind: "brise_soleil";
  /** Fraction of the segment covered, 0..1. */
  coverage: number;
  /** Fin depth out from the facade, feet. */
  projection: number;
  /** Fin spacing on centre, feet. */
  spacing: number;
  orientation: "vertical" | "horizontal";
}

/** Projecting or recessed balconies, repeated up the elevation. */
export interface BalconyFeature extends FeatureBase {
  kind: "balcony";
  width: number;
  /** Depth out from (or into) the facade, feet. */
  projection: number;
  fromFloor: number;
  toFloor: number;
  /** Recessed balconies cut into the plate instead of hanging off it. */
  recessed: boolean;
  /** Bays across the segment; 1 is a single balcony. */
  count: number;
}

/** A recessed outdoor room cut into the elevation. */
export interface LoggiaFeature extends FeatureBase {
  kind: "loggia";
  width: number;
  /** How far it is cut into the plan, feet. */
  depth: number;
  fromFloor: number;
  toFloor: number;
}

/** A fully glazed corner, wrapping two walls. */
export interface FeatureCornerFeature extends FeatureBase {
  kind: "feature_corner";
  /** Wrap length onto each wall, feet. */
  wrap: number;
  fromFloor: number;
  toFloor: number;
}

/** A multi-storey void cut through the plates, glazed above. */
export interface AtriumFeature extends FeatureBase {
  kind: "atrium";
  width: number;
  depth: number;
  /** Floors the void passes through, from the ground up. */
  floors: number;
  /** Glazed roof over the void. */
  skylight: boolean;
}

/** A link bridge between wings, or to a neighbouring building. */
export interface ConnectorFeature extends FeatureBase {
  kind: "connector";
  /** Span, feet. */
  length: number;
  width: number;
  floors: number;
  /** Height above the base the connector starts at, feet. */
  height: number;
  glazed: boolean;
}

/** An occupiable roof deck, usually on a setback. */
export interface TerraceFeature extends FeatureBase {
  kind: "terrace";
  /** Deck area, SF. */
  area: number;
  /** Guard rail run, feet. */
  railing: number;
  planters: boolean;
}

/** Entry plaza or patio hardscape at grade. */
export interface PlazaFeature extends FeatureBase {
  kind: "plaza";
  width: number;
  depth: number;
  /** Paving grade drives the rate: plain, unit paver, or feature paving. */
  grade: "plain" | "unit_paver" | "feature";
  seatWall: number;
}

/** A shade structure over a patio or walkway. */
export interface PergolaFeature extends FeatureBase {
  kind: "pergola";
  width: number;
  projection: number;
  height: number;
  material: "timber" | "steel" | "aluminium";
}

export type Feature =
  | CanopyFeature
  | PorteCochereFeature
  | BayFeature
  | LobbyFeature
  | SunshadeFeature
  | BriseSoleilFeature
  | BalconyFeature
  | LoggiaFeature
  | FeatureCornerFeature
  | AtriumFeature
  | ConnectorFeature
  | TerraceFeature
  | PlazaFeature
  | PergolaFeature
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
    case "brise_soleil":
      // Spacing well above the projection, so the array reads as separate fins
      // from an oblique view instead of closing into a solid plane.
      return { ...base, kind, coverage: 0.75, projection: 2, spacing: 6, orientation: "vertical", ...over } as BriseSoleilFeature;
    case "balcony":
      return { ...base, kind, width: 10, projection: 6, fromFloor: 1, toFloor: 99, recessed: false, count: 4, ...over } as BalconyFeature;
    case "loggia":
      return { ...base, kind, width: 24, depth: 10, fromFloor: 0, toFloor: 0, ...over } as LoggiaFeature;
    case "feature_corner":
      return { ...base, kind, wrap: 18, fromFloor: 0, toFloor: 99, ...over } as FeatureCornerFeature;
    case "atrium":
      return { ...base, kind, segment: -1, width: 40, depth: 30, floors: 3, skylight: true, ...over } as AtriumFeature;
    case "connector":
      return { ...base, kind, length: 40, width: 14, floors: 1, height: 0, glazed: true, ...over } as ConnectorFeature;
    case "terrace":
      return { ...base, kind, segment: -1, area: 2000, railing: 140, planters: true, ...over } as TerraceFeature;
    case "plaza":
      return { ...base, kind, width: 60, depth: 40, grade: "unit_paver", seatWall: 40, ...over } as PlazaFeature;
    case "pergola":
      return { ...base, kind, width: 30, projection: 14, height: 10, material: "steel", ...over } as PergolaFeature;
  }
}

export const FEATURE_LABELS: Record<FeatureKind, string> = {
  canopy: "Entry canopy",
  porte_cochere: "Porte cochere",
  bay: "Projecting bay",
  lobby: "Glazed lobby volume",
  sunshade: "Sunshades",
  brise_soleil: "Brise-soleil / fins",
  balcony: "Balconies",
  loggia: "Recessed loggia",
  feature_corner: "Glazed feature corner",
  atrium: "Atrium / lightwell",
  connector: "Link connector",
  terrace: "Roof terrace",
  plaza: "Plaza / patio",
  pergola: "Pergola",
  roof_screen: "Rooftop screen",
  cornice: "Cornice band",
};

/** Features that belong to the whole building rather than one wall. */
export const WHOLE_BUILDING_FEATURES: ReadonlySet<FeatureKind> = new Set<FeatureKind>([
  "sunshade",
  "roof_screen",
  "cornice",
  "atrium",
  "terrace",
]);

/** One line describing what a feature does to the number. */
export const FEATURE_COST_NOTES: Record<FeatureKind, string> = {
  canopy: "Priced per SF of canopy; column support costs more than a cantilever.",
  porte_cochere: "Priced per SF of cover, plus each column.",
  bay: "Adds envelope area on three sides and removes the flat wall behind it.",
  lobby: "Storefront glazing at a premium rate, plus the extra volume's structure.",
  sunshade: "Priced per linear foot of shade.",
  roof_screen: "Priced per SF of screen, by material.",
  cornice: "Priced per linear foot.",
  brise_soleil: "Priced per SF of fin face, which rises steeply with depth and falls with spacing.",
  balcony: "Deck, soffit and guard rail. A recessed balcony trades deck cost for lost floor area.",
  loggia: "Removes floor area and exterior wall, adds soffit and a deeper reveal.",
  feature_corner: "Swaps opaque wall for curtain wall around the corner on both elevations.",
  atrium: "Removes floor plate on every level it passes, adds interior glazing and a skylight.",
  connector: "A bridge is structure, envelope and floor all at once, per SF of deck.",
  terrace: "Paving, guard rail and planters over an occupiable roof.",
  plaza: "Hardscape by paving grade, plus seat wall by the foot.",
  pergola: "Priced per SF of cover, by material.",
};

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

export interface FeatureQuantities {
  /** rate key -> quantity. */
  quantities: Record<string, number>;
  /**
   * Floor plate area removed on every level a void passes through, SF.
   * An atrium is the obvious case: it is the one feature that makes a building
   * smaller, and pretending otherwise overstates both the area and the fee.
   */
  plateDelta: number;
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
  let plateDelta = 0;

  if (feature.disabled) return { quantities, wallDelta, glazingDelta, plateDelta };

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

    case "brise_soleil": {
      const run = segmentLength * Math.max(0, Math.min(1, feature.coverage));
      const height = ctx.floors * ctx.floorToFloor;
      // Fin face area: one fin per spacing, each the full height and depth.
      const fins = Math.max(1, Math.floor(run / Math.max(0.75, feature.spacing)));
      add(quantities, "brise_soleil", fins * feature.projection * (feature.orientation === "vertical" ? height : run / fins));
      break;
    }

    case "balcony": {
      const top = Math.min(feature.toFloor, ctx.floors - 1);
      const levels = Math.max(0, top - feature.fromFloor + 1);
      if (levels <= 0) break;
      const count = Math.max(1, feature.count) * levels;
      const deckArea = count * feature.width * feature.projection;

      add(quantities, feature.recessed ? "balcony_recessed" : "balcony_projecting", deckArea);
      add(quantities, "guard_rail", count * (feature.width + feature.projection * 2));

      if (feature.recessed) {
        // Cut into the plate: floor area lost, and the wall moves inward.
        plateDelta -= deckArea;
      } else {
        // Hung off the face: three new edges of soffit and rail, no plate change.
        wallDelta += count * feature.projection * 2 * 0.5;
      }
      break;
    }

    case "loggia": {
      const top = Math.min(feature.toFloor, ctx.floors - 1);
      const levels = Math.max(0, top - feature.fromFloor + 1);
      if (levels <= 0) break;
      const width = Math.min(feature.width, segmentLength);
      const area = width * feature.depth * levels;

      plateDelta -= area;
      add(quantities, "loggia_soffit", area);
      add(quantities, "guard_rail", width * levels);
      // The recess adds two side walls where the flat facade used to be.
      wallDelta += 2 * feature.depth * levels * ctx.floorToFloor;
      break;
    }

    case "feature_corner": {
      const top = Math.min(feature.toFloor, ctx.floors - 1);
      const levels = Math.max(0, top - feature.fromFloor + 1);
      if (levels <= 0) break;
      // Wraps both walls at the corner, so twice the wrap length.
      const area = 2 * feature.wrap * levels * ctx.floorToFloor;
      add(quantities, "curtain", area);
      glazingDelta += area;
      break;
    }

    case "atrium": {
      const levels = Math.max(1, Math.min(feature.floors, ctx.floors));
      const void_ = feature.width * feature.depth;
      // The ground floor keeps its area; every level above loses the void.
      plateDelta -= void_ * Math.max(0, levels - 1);
      add(quantities, "atrium_glazing", 2 * (feature.width + feature.depth) * levels * ctx.floorToFloor * 0.6);
      add(quantities, "guard_rail", 2 * (feature.width + feature.depth) * Math.max(0, levels - 1));
      if (feature.skylight) add(quantities, "skylight", void_);
      break;
    }

    case "connector": {
      const deck = feature.length * feature.width * Math.max(1, feature.floors);
      add(quantities, "connector_structure", deck);
      if (feature.glazed) {
        add(quantities, "curtain", 2 * feature.length * feature.floors * ctx.floorToFloor);
      }
      add(quantities, "roof", feature.length * feature.width);
      break;
    }

    case "terrace": {
      add(quantities, "terrace_deck", Math.max(0, feature.area));
      add(quantities, "guard_rail", Math.max(0, feature.railing));
      if (feature.planters) add(quantities, "planter", Math.max(0, feature.area) * 0.12);
      break;
    }

    case "plaza": {
      const area = Math.max(0, feature.width * feature.depth);
      const key =
        feature.grade === "feature" ? "paving_feature" : feature.grade === "unit_paver" ? "paving_unit" : "site_patio";
      add(quantities, key, area);
      if (feature.seatWall > 0) add(quantities, "seat_wall", feature.seatWall);
      break;
    }

    case "pergola": {
      add(quantities, `pergola_${feature.material}`, feature.width * feature.projection);
      break;
    }
  }

  return { quantities, wallDelta, glazingDelta, plateDelta };
}

/** Roll every feature on a mass into one set of adjustments. */
export function featuresTakeoff(features: Feature[], ctx: FeatureContext): FeatureQuantities {
  const quantities: Record<string, number> = {};
  let wallDelta = 0;
  let glazingDelta = 0;
  let plateDelta = 0;

  for (const feature of features) {
    const result = featureTakeoff(feature, ctx);
    for (const [key, value] of Object.entries(result.quantities)) add(quantities, key, value);
    wallDelta += result.wallDelta;
    glazingDelta += result.glazingDelta;
    plateDelta += result.plateDelta;
  }

  return { quantities, wallDelta, glazingDelta, plateDelta };
}

/** Cardinal a feature faces, for describing it to an image model. */
export const featureCardinal = (feature: Feature, segments: FacadeSegment[]): Cardinal | null =>
  feature.segment >= 0 ? (segments[feature.segment]?.cardinal ?? null) : null;
