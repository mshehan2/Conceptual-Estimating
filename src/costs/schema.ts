/**
 * Cost data schema.
 *
 * Every priced number in this app is a `Quoted<T>` — a value bound to the
 * provenance that produced it. That is the whole trick behind "seed library
 * now, live DESTINI endpoint later": call sites consume `Quoted` values and
 * never learn where the number came from, so replacing the source changes
 * nothing downstream except what the provenance chip reads.
 *
 * Units are US customary because that is what conceptual estimating uses:
 * feet, square feet, linear feet, cubic yards, and each.
 */

// ---------------------------------------------------------------------------
// Units of measure
// ---------------------------------------------------------------------------

/** Units a cost can be expressed per. */
export type Uom =
  | "SF" // square foot (of the measured quantity — floor, wall, roof, site)
  | "GSF" // gross square foot of building
  | "LF" // linear foot
  | "CY" // cubic yard
  | "EA" // each
  | "TON" // cooling tons
  | "STALL" // parking stall
  | "UNIT" // dwelling unit / apartment / suite
  | "KEY" // hotel key
  | "BED" // licensed bed
  | "SEAT" // fixed seat
  | "STUDENT"
  | "LS"; // lump sum

export const UOM_LABEL: Record<Uom, string> = {
  SF: "$/SF",
  GSF: "$/GSF",
  LF: "$/LF",
  CY: "$/CY",
  EA: "$/ea",
  TON: "$/ton",
  STALL: "$/stall",
  UNIT: "$/unit",
  KEY: "$/key",
  BED: "$/bed",
  SEAT: "$/seat",
  STUDENT: "$/student",
  LS: "lump sum",
};

/** Capacity-style denominators — the "per what" of a conceptual benchmark. */
export const CAPACITY_UOMS: readonly Uom[] = ["UNIT", "KEY", "BED", "SEAT", "STUDENT", "STALL"] as const;

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** How much weight a consumer should give a number. */
export type Confidence = "high" | "medium" | "low" | "placeholder";

export const CONFIDENCE_RANK: Record<Confidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
  placeholder: 0,
};

/** Where a number came from, carried alongside the number itself. */
export interface Provenance {
  /** Id of the `CostSource` that produced this. */
  sourceId: string;
  /** Human label for the source, e.g. "DESTINI Historical (Q3 2026)". */
  sourceLabel: string;
  sourceKind: SourceKind;
  /** Native identifier in the system of record — DESTINI line id, row guid. */
  externalId?: string;
  /** ISO date the underlying data is current as of. */
  asOf?: string;
  /** Free-text basis note: "12 projects, mid-Atlantic, 2023-2025". */
  basis?: string;
  confidence: Confidence;
  /** Number of source projects/observations behind the number, when known. */
  sampleSize?: number;
  /** True when this value was derived rather than read directly. */
  derived?: boolean;
  /** Human-readable note about any derivation or adjustment applied. */
  note?: string;
}

/** A value bound to its provenance. */
export interface Quoted<T = number> {
  value: T;
  provenance: Provenance;
}

export const quote = <T,>(value: T, provenance: Provenance): Quoted<T> => ({ value, provenance });

// ---------------------------------------------------------------------------
// Market / type addressing
// ---------------------------------------------------------------------------

/**
 * Cost data is addressed by market, then building type — mirroring how you
 * iterate on a project. Both are stable string ids from the market registry.
 */
export interface MarketAddress {
  marketId: string;
  /** Omit to ask for the market-wide figure. */
  typeId?: string;
}

/** Geography for a lookup. Progressively specific; sources match best-effort. */
export interface GeoScope {
  /** ENR-style city label, e.g. "Philadelphia PA". */
  city?: string;
  /** Two-letter state. */
  state?: string;
  /** Named region bucket, e.g. "Mid-Atlantic". */
  region?: string;
  lat?: number;
  lon?: number;
}

// ---------------------------------------------------------------------------
// Conceptual benchmarks ($/SF, $/unit, $/bed …)
// ---------------------------------------------------------------------------

/**
 * A whole-building or whole-scope conceptual rate: what this market+type costs
 * per SF (or per unit/bed/key) all-in, before location and escalation.
 *
 * Sources publish a range, not a point. Keeping low/likely/high lets the app
 * show a band instead of pretending to a precision conceptual data cannot have.
 */
export interface ConceptualBenchmark {
  id: string;
  marketId: string;
  typeId?: string;
  /** What the rate is measured per. */
  uom: Uom;
  low: number;
  likely: number;
  high: number;
  /** What the rate includes — drives whether indirects get added on top. */
  scope: CostScope;
  /** Index the rate is stated at (100 = national baseline). */
  indexBasis: number;
  /** ISO date the rate is priced at, for escalation to the project midpoint. */
  pricedAt: string;
  geo?: GeoScope;
  provenance: Provenance;
  /** Typical efficiency (net/gross) observed for this type, 0..1. */
  efficiency?: number;
  /** Typical GSF per capacity unit — e.g. 900 GSF per apartment. */
  gsfPerCapacity?: number;
  label?: string;
}

/** What a published rate is understood to include. */
export type CostScope =
  | "direct" // trade cost only
  | "construction" // direct + GC fee/GCs/bond — i.e. the contract sum
  | "project"; // construction + design, FF&E, owner contingency

export const COST_SCOPE_LABEL: Record<CostScope, string> = {
  direct: "Direct trade cost",
  construction: "Construction cost",
  project: "Total project cost",
};

// ---------------------------------------------------------------------------
// Unit costs (division / assembly rates)
// ---------------------------------------------------------------------------

/**
 * A single priced assembly — the granular half of the feed. These are what the
 * bottom-up takeoff multiplies quantities by.
 *
 * `key` is BUD's internal rate key (e.g. "wall_brick", "partition",
 * "elevated_floor"). Keeping a stable internal key separate from the source's
 * own coding is what lets a DESTINI import, a seed value, and a user override
 * all answer the same question.
 */
export interface UnitCostLine {
  id: string;
  /** Stable internal rate key the estimating engine asks for. */
  key: string;
  label: string;
  uom: Uom;
  low: number;
  likely: number;
  high: number;
  /** CSI MasterFormat division, e.g. "03" or "09 65 00". */
  csi?: string;
  /** UNIFORMAT II element, e.g. "B2010" exterior walls. */
  uniformat?: string;
  /** Optional market/type narrowing — an OR block costs more in a hospital. */
  marketId?: string;
  typeId?: string;
  indexBasis: number;
  pricedAt: string;
  geo?: GeoScope;
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Indices
// ---------------------------------------------------------------------------

/** Location and time adjustment for a geography. */
export interface CostIndex {
  /** 100 = national baseline the catalog rates are stated at. */
  location: number;
  /** Annual escalation, percent. */
  escalationPctPerYear: number;
  city?: string;
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface ConceptualQuery extends MarketAddress {
  geo?: GeoScope;
  /** Restrict to a scope; omit for any. */
  scope?: CostScope;
  uom?: Uom;
}

export interface UnitCostQuery {
  /** Ask for specific rate keys; omit for the source's whole catalog. */
  keys?: string[];
  marketId?: string;
  typeId?: string;
  geo?: GeoScope;
}

export interface IndexQuery {
  geo: GeoScope;
  /** ISO date of construction midpoint, for time escalation. */
  midpoint?: string;
}

// ---------------------------------------------------------------------------
// Source identity
// ---------------------------------------------------------------------------

export type SourceKind = "seed" | "destini-api" | "import" | "override" | "derived";

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  seed: "Seed library",
  "destini-api": "DESTINI (live)",
  import: "DESTINI export",
  override: "Manual override",
  derived: "Derived",
};
