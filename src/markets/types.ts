/**
 * Market and building-type model.
 *
 * A project is iterated market-first, then type: pick "Senior Living", then
 * "Assisted Living", and the app seeds a scheme — massing defaults, program
 * mix, efficiency band, parking ratio — and points every cost lookup at that
 * market/type address. Changing the type re-seeds without losing the project.
 */

import type { Uom } from "@/costs/schema";

/** Glazing strategy presets carried over from the massing engine. */
export type GlazingPreset = "none" | "punched" | "strip" | "full";

/** Exterior skin keys understood by the renderer and the envelope takeoff. */
export type SkinKey =
  | "brick"
  | "fiber_cement"
  | "metal_panel"
  | "stucco"
  | "precast"
  | "curtain_wall"
  | "eifs"
  | "wood"
  | "stone"
  | "tilt_up"
  | "insulated_panel";

export type RoofKind = "flat" | "gable" | "hip";

/** Primary structural system — drives structure rates and bay sizing. */
export type StructureSystem =
  | "wood_frame"
  | "light_gauge"
  | "steel"
  | "concrete"
  | "tilt_up"
  | "podium"; // Type III over Type I

/**
 * How much of a building a type's scope covers.
 *   full       — substructure through finishes
 *   shell      — structure, envelope, core; no tenant fit-out
 *   interiors  — fit-out inside someone else's shell
 *   structure  — a frame with no interior program (parking decks)
 *   site       — no building at all; paving and site improvements only
 */
export type ScopeMode = "full" | "shell" | "interiors" | "structure" | "site";

/** Planning defaults a building type seeds into a new scheme. */
export interface TypeDefaults {
  /** Defaults to "full" when omitted. */
  scopeMode?: ScopeMode;
  /** Cost profile id applied to rates for this type. Defaults by structure. */
  costProfile?: string;
  floors: number;
  /** Floor-to-floor height, feet. */
  floorToFloor: number;
  /** Starting footprint, feet. */
  footprint: { w: number; d: number };
  /** Net-to-gross multiplier applied to net program. */
  grossing: number;
  glazing: GlazingPreset;
  /** Percent of facade length glazed. */
  glazingCoverage: number;
  skin: SkinKey;
  roof: RoofKind;
  structure: StructureSystem;
  /** Exit travel distance limit, feet — drives stair count. */
  travelDistance: number;
  /** Typical structural bay, feet. */
  bay?: { w: number; d: number };
  /** Parking stalls per capacity unit. */
  parkingRatio?: number;
  /** True when the type is normally sprinklered/high-rise-rated. */
  highRise?: boolean;
  /** True when the type is normally built below grade (excavation, shoring). */
  belowGrade?: boolean;
}

/** Observed net-to-gross efficiency band for a type, as fractions 0..1. */
export interface EfficiencyBand {
  low: number;
  typical: number;
  high: number;
}

/** A share of program capacity assigned to a unit-catalog entry. */
export interface ProgramMixEntry {
  /** Matches a unit catalog `ref`. */
  unitRef: string;
  /** Fraction of total capacity, 0..1. Shares within a type sum to ~1. */
  share: number;
}

/** Support/amenity space carried as a fraction of net program area. */
export interface SupportSpaceEntry {
  unitRef: string;
  /** SF per capacity unit, e.g. 35 SF of dining per apartment. */
  sfPerCapacity: number;
}

export interface BuildingTypeDef {
  id: string;
  marketId: string;
  label: string;
  /** Abbreviation for dense UI, e.g. "AL". */
  short: string;
  description: string;
  /** What this type's capacity is counted in. */
  capacityUom: Uom;
  /** Plural noun for the capacity, e.g. "apartments", "keys", "beds". */
  capacityLabel: string;
  defaults: TypeDefaults;
  efficiency: EfficiencyBand;
  /** Unit catalog refs available to this type, in menu order. */
  unitRefs: string[];
  /** Default program mix used to seed a scheme from a capacity target. */
  programMix: ProgramMixEntry[];
  /** Amenity/support program scaled off capacity. */
  supportSpaces?: SupportSpaceEntry[];
  /**
   * Gross SF per capacity unit. Required for density-measured types (students,
   * seats) where the capacity target describes occupancy rather than a count of
   * rooms — 900 students is 900 x 165 GSF, not 900 classrooms.
   */
  gsfPerCapacity?: number;
  /** Typical project size range in capacity units, for sanity checks. */
  typicalCapacity?: { low: number; high: number };
  tags?: string[];
}

export interface MarketDef {
  id: string;
  label: string;
  short: string;
  description: string;
  /** Accent color for charts, chips, and mass coloring. */
  color: string;
  /** Ordered building types within the market. */
  typeIds: string[];
}
