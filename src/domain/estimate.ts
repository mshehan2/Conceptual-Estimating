/**
 * The estimate.
 *
 * Two independent readings of the same scheme, deliberately kept side by side:
 *
 *   Bottom-up — quantities × resolved unit costs, rolled into UNIFORMAT
 *   divisions. Sensitive to what you actually drew.
 *
 *   Top-down — the conceptual $/GSF or $/capacity benchmark for the market and
 *   building type. Sensitive to what the market says a building like this costs.
 *
 * Neither is the truth. The gap between them is the interesting number, and
 * `reconcile` reports it rather than hiding it behind a single figure.
 */

import type { CostResolver, ResolvedRate } from "@/costs/resolver";
import { escalationFactor, locationFactor } from "@/costs/resolver";
import type { ConceptualBenchmark, Confidence, CostScope, Provenance, Uom } from "@/costs/schema";
import { CONFIDENCE_RANK } from "@/costs/schema";
import type { Takeoff } from "./takeoff";

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------

/** UNIFORMAT-aligned rollup groups, in report order. */
export const DIVISIONS = [
  { id: "substructure", label: "Substructure", uniformat: "A" },
  { id: "shell", label: "Shell", uniformat: "B" },
  { id: "interiors", label: "Interiors", uniformat: "C" },
  { id: "services", label: "Services", uniformat: "D" },
  { id: "equipment", label: "Equipment & Furnishings", uniformat: "E" },
  { id: "sitework", label: "Sitework", uniformat: "G" },
] as const;

export type DivisionId = (typeof DIVISIONS)[number]["id"];

/** Which division a rate key rolls into, by UNIFORMAT prefix. */
export function divisionForUniformat(uniformat: string | undefined): DivisionId {
  const c = (uniformat ?? "").charAt(0).toUpperCase();
  switch (c) {
    case "A": return "substructure";
    case "B": return "shell";
    case "C": return "interiors";
    case "D": return "services";
    case "E": return "equipment";
    case "G": return "sitework";
    default: return "interiors";
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Percentages of direct cost. */
export interface IndirectSettings {
  generalConditions: number;
  fee: number;
  contingency: number;
  design: number;
  bond: number;
  insurance: number;
}

export const DEFAULT_INDIRECTS: IndirectSettings = {
  generalConditions: 8,
  fee: 4,
  contingency: 8,
  design: 6,
  bond: 1,
  insurance: 1.5,
};

export interface MarketAdjustment {
  /** Target location index; rates are scaled from their own stated basis. */
  locationIndex: number;
  /** Annual escalation percent. */
  escalationPctPerYear: number;
  /** ISO date of construction midpoint. */
  midpoint?: string;
  city?: string;
}

export const DEFAULT_ADJUSTMENT: MarketAdjustment = {
  locationIndex: 100,
  escalationPctPerYear: 4,
};

/** Which point in each cost band to price at. */
export type BandPoint = "low" | "likely" | "high";

// ---------------------------------------------------------------------------
// Bottom-up estimate
// ---------------------------------------------------------------------------

export interface EstimateLine {
  key: string;
  label: string;
  uom: Uom;
  quantity: number;
  /** Rate after location and escalation adjustment. */
  rate: number;
  /** Rate as published by the source, before adjustment. */
  baseRate: number;
  amount: number;
  division: DivisionId;
  csi?: string;
  uniformat?: string;
  provenance: Provenance;
  /** Values from lower-priority sources for the same key. */
  superseded: { rate: number; sourceLabel: string; confidence: Confidence }[];
  /** True when no source could price this quantity. */
  unpriced?: boolean;
}

export interface DivisionTotal {
  id: DivisionId;
  label: string;
  amount: number;
  perGSF: number;
  pctOfDirect: number;
  lines: EstimateLine[];
}

export interface BottomUpEstimate {
  lines: EstimateLine[];
  divisions: DivisionTotal[];
  direct: number;
  indirects: { label: string; pct: number; amount: number; scope: CostScope }[];
  indirectTotal: number;
  /**
   * Totals by scope, so a comparison against a published benchmark is
   * like-for-like. Conceptual guidance is almost always quoted at
   * `construction` scope — the contract sum — and silently comparing it to a
   * number that carries design fees overstates the project by the design
   * percentage.
   */
  construction: number;
  project: number;
  /** Alias of `project`: the all-in number. */
  total: number;
  perGSF: number;
  perUnit: number | null;
  perBed: number | null;
  /** Quantities no source could price — the honest gap list. */
  unpriced: { key: string; quantity: number }[];
  /** Lowest confidence appearing in any priced line. */
  weakestConfidence: Confidence;
  /** Share of direct cost coming from each source, by label. */
  sourceMix: { sourceLabel: string; amount: number; pct: number }[];
  adjustment: { locationFactor: number; escalationFactor: number };
}

export function priceBottomUp(
  t: Takeoff,
  rates: Map<string, ResolvedRate>,
  opts: {
    indirects?: IndirectSettings;
    adjustment?: MarketAdjustment;
    band?: BandPoint;
  } = {},
): BottomUpEstimate {
  const indirectSettings = opts.indirects ?? DEFAULT_INDIRECTS;
  const adj = opts.adjustment ?? DEFAULT_ADJUSTMENT;
  const band = opts.band ?? "likely";

  const lines: EstimateLine[] = [];
  const unpriced: { key: string; quantity: number }[] = [];

  for (const [key, quantity] of Object.entries(t.quantities)) {
    if (!quantity) continue;
    const resolved = rates.get(key);
    if (!resolved) {
      unpriced.push({ key, quantity });
      continue;
    }

    const line = resolved.line;
    const baseRate = line[band];
    const locF = locationFactor(line.indexBasis, adj.locationIndex);
    const escF = escalationFactor(line.pricedAt, adj.midpoint, adj.escalationPctPerYear);
    const rate = baseRate * locF * escF;

    lines.push({
      key,
      label: line.label,
      uom: line.uom,
      quantity,
      rate,
      baseRate,
      amount: rate * quantity,
      division: divisionForUniformat(line.uniformat),
      csi: line.csi,
      uniformat: line.uniformat,
      provenance: line.provenance,
      superseded: resolved.superseded.map((s) => ({
        rate: s[band],
        sourceLabel: s.provenance.sourceLabel,
        confidence: s.provenance.confidence,
      })),
    });
  }

  lines.sort((a, b) => (a.uniformat ?? "").localeCompare(b.uniformat ?? "") || b.amount - a.amount);

  const direct = lines.reduce((a, l) => a + l.amount, 0);

  const indirects: BottomUpEstimate["indirects"] = [
    { label: "General conditions", pct: indirectSettings.generalConditions, scope: "construction" as CostScope },
    { label: "Insurance", pct: indirectSettings.insurance, scope: "construction" as CostScope },
    { label: "Bond", pct: indirectSettings.bond, scope: "construction" as CostScope },
    { label: "Fee", pct: indirectSettings.fee, scope: "construction" as CostScope },
    { label: "Design contingency", pct: indirectSettings.contingency, scope: "construction" as CostScope },
    { label: "Design fees", pct: indirectSettings.design, scope: "project" as CostScope },
  ].map((i) => ({ ...i, amount: direct * (i.pct / 100) }));

  const indirectTotal = indirects.reduce((a, i) => a + i.amount, 0);
  const construction =
    direct + indirects.filter((i) => i.scope === "construction").reduce((a, i) => a + i.amount, 0);
  const project = direct + indirectTotal;
  const total = project;

  const divisions: DivisionTotal[] = DIVISIONS.map((d) => {
    const divLines = lines.filter((l) => l.division === d.id);
    const amount = divLines.reduce((a, l) => a + l.amount, 0);
    return {
      id: d.id,
      label: d.label,
      amount,
      perGSF: t.gsf > 0 ? amount / t.gsf : 0,
      pctOfDirect: direct > 0 ? (amount / direct) * 100 : 0,
      lines: divLines,
    };
  }).filter((d) => d.lines.length > 0);

  const bySource = new Map<string, number>();
  for (const l of lines) {
    bySource.set(l.provenance.sourceLabel, (bySource.get(l.provenance.sourceLabel) ?? 0) + l.amount);
  }
  const sourceMix = [...bySource.entries()]
    .map(([sourceLabel, amount]) => ({ sourceLabel, amount, pct: direct > 0 ? (amount / direct) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);

  const weakestConfidence = lines.reduce<Confidence>((worst, l) => {
    const c = l.provenance.confidence;
    return CONFIDENCE_RANK[c] < CONFIDENCE_RANK[worst] ? c : worst;
  }, "high");

  return {
    lines,
    divisions,
    direct,
    indirects,
    indirectTotal,
    construction,
    project,
    total,
    perGSF: t.gsf > 0 ? total / t.gsf : 0,
    perUnit: t.units > 0 ? total / t.units : null,
    perBed: t.beds > 0 ? total / t.beds : null,
    unpriced,
    weakestConfidence,
    sourceMix,
    adjustment: {
      locationFactor: adj.locationIndex / 100,
      escalationFactor: escalationFactor("2026-01-01", adj.midpoint, adj.escalationPctPerYear),
    },
  };
}

// ---------------------------------------------------------------------------
// Top-down conceptual estimate
// ---------------------------------------------------------------------------

export interface ConceptualEstimate {
  /** The measure the benchmark was applied against. */
  basis: { uom: Uom; quantity: number };
  low: number;
  likely: number;
  high: number;
  perGSF: number;
  benchmark: ConceptualBenchmark;
  provenance: Provenance;
  adjustment: { locationFactor: number; escalationFactor: number };
}

export function priceTopDown(
  t: Takeoff,
  benchmark: ConceptualBenchmark,
  opts: { adjustment?: MarketAdjustment } = {},
): ConceptualEstimate | null {
  const adj = opts.adjustment ?? DEFAULT_ADJUSTMENT;
  const quantity = quantityFor(t, benchmark.uom);
  if (quantity == null || quantity <= 0) return null;

  const locF = locationFactor(benchmark.indexBasis, adj.locationIndex);
  const escF = escalationFactor(benchmark.pricedAt, adj.midpoint, adj.escalationPctPerYear);
  const f = locF * escF * quantity;

  const likely = benchmark.likely * f;
  return {
    basis: { uom: benchmark.uom, quantity },
    low: benchmark.low * f,
    likely,
    high: benchmark.high * f,
    perGSF: t.gsf > 0 ? likely / t.gsf : 0,
    benchmark,
    provenance: benchmark.provenance,
    adjustment: { locationFactor: locF, escalationFactor: escF },
  };
}

/** The takeoff measure a benchmark's unit of measure applies to. */
function quantityFor(t: Takeoff, uom: Uom): number | null {
  switch (uom) {
    case "GSF":
    case "SF":
      return t.gsf;
    case "UNIT":
    case "KEY":
      return t.capacity[uom] ?? t.units;
    case "BED":
      return t.capacity.BED ?? t.beds ?? t.units;
    default:
      // Everything else — stalls, operating rooms, seats — is only knowable
      // from the program, so an unprogrammed measure yields no reading rather
      // than a misleading one.
      return t.capacity[uom] ?? null;
  }
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface Reconciliation {
  /** The scope both sides were compared at. */
  scope: CostScope;
  bottomUp: number;
  conceptualLikely: number;
  conceptualLow: number;
  conceptualHigh: number;
  /** Bottom-up minus conceptual likely. */
  variance: number;
  variancePct: number;
  /** True when the bottom-up number sits inside the published band. */
  withinBand: boolean;
  verdict: "within band" | "below band" | "above band";
}

/**
 * Compare bottom-up against the conceptual band at the benchmark's own scope.
 * A `construction`-scope benchmark is measured against the contract sum, not
 * against a total that carries design fees.
 */
export function reconcile(bottomUp: BottomUpEstimate, conceptual: ConceptualEstimate): Reconciliation {
  const scope = conceptual.benchmark.scope;
  const mine =
    scope === "direct" ? bottomUp.direct : scope === "construction" ? bottomUp.construction : bottomUp.project;
  const variance = mine - conceptual.likely;
  const withinBand = mine >= conceptual.low && mine <= conceptual.high;
  return {
    scope,
    bottomUp: mine,
    conceptualLikely: conceptual.likely,
    conceptualLow: conceptual.low,
    conceptualHigh: conceptual.high,
    variance,
    variancePct: conceptual.likely > 0 ? (variance / conceptual.likely) * 100 : 0,
    withinBand,
    verdict: withinBand ? "within band" : mine < conceptual.low ? "below band" : "above band",
  };
}

// ---------------------------------------------------------------------------
// Full estimate for a scheme
// ---------------------------------------------------------------------------

export interface SchemeEstimate {
  takeoff: Takeoff;
  bottomUp: BottomUpEstimate;
  conceptual: ConceptualEstimate | null;
  conceptualByUom: ConceptualEstimate[];
  reconciliation: Reconciliation | null;
}

/** Price a takeoff both ways against whatever sources are registered. */
export async function estimateScheme(
  t: Takeoff,
  resolver: CostResolver,
  opts: {
    marketId?: string;
    typeId?: string;
    indirects?: IndirectSettings;
    adjustment?: MarketAdjustment;
    band?: BandPoint;
  } = {},
): Promise<SchemeEstimate> {
  const keys = Object.keys(t.quantities);
  const [rates, benchmarks] = await Promise.all([
    resolver.rates(keys, { marketId: opts.marketId, typeId: opts.typeId }),
    opts.marketId
      ? resolver.conceptual({ marketId: opts.marketId, typeId: opts.typeId })
      : Promise.resolve(new Map()),
  ]);

  const bottomUp = priceBottomUp(t, rates, opts);

  const conceptualByUom = [...benchmarks.values()]
    .map((r) => priceTopDown(t, r.benchmark, opts))
    .filter((c): c is ConceptualEstimate => c !== null);

  // Prefer the per-GSF reading as the headline where there is floor area to
  // measure; a surface lot has none, so it falls through to its per-stall rate.
  const conceptual =
    conceptualByUom.find((c) => c.benchmark.uom === "GSF") ?? conceptualByUom[0] ?? null;

  return {
    takeoff: t,
    bottomUp,
    conceptual,
    conceptualByUom,
    reconciliation: conceptual ? reconcile(bottomUp, conceptual) : null,
  };
}
