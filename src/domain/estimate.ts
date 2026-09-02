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

import type { CostResolver, ResolvedBenchmark, ResolvedRate } from "@/costs/resolver";
import { escalationFactor, locationFactor } from "@/costs/resolver";
import { blendBenchmarks, blendRates, normalizeMix, type TypeMixEntry } from "@/costs/blend";
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

/**
 * One step in the markup cascade.
 *
 * Order matters, because each step is a percentage of the RUNNING SUBTOTAL and
 * not of direct cost. That is how Benchmark's workbook computes it and it is
 * not a rounding detail: on UPC 1 the eleven rows sum to 23.10%, and taking
 * that flat against building and site gives $10,853,997 where compounding
 * gives $11,960,110. Flat understates by 10.2%.
 */
export interface MarkupStep {
  id: string;
  label: string;
  pct: number;
  /** Design fees sit outside construction scope for market band comparison. */
  scope: CostScope;
}

/**
 * Benchmark's standard cascade, in order.
 *
 * These are the rates from the UPC 1 model. The 8/21/2026 owner direction cut
 * GC personnel to 5% and design contingency to 0% on the Hospital and Crescent
 * models but not on UPC 1, which is exactly why this list belongs to the
 * scheme rather than to the app.
 */
export const BENCHMARK_CASCADE: readonly MarkupStep[] = [
  { id: "sdi", label: "SDI", pct: 1.25, scope: "construction" },
  { id: "gc_personnel", label: "GC personnel", pct: 6.0, scope: "construction" },
  { id: "gc_nonpersonnel", label: "GC non-personnel", pct: 1.0, scope: "construction" },
  { id: "precon", label: "Preconstruction fees", pct: 0.25, scope: "construction" },
  { id: "overhead", label: "Overhead and Procore", pct: 0.4, scope: "construction" },
  { id: "permits", label: "Permits", pct: 2.0, scope: "construction" },
  { id: "privilege_tax", label: "Business privilege tax", pct: 0, scope: "construction" },
  { id: "gl_insurance", label: "GL insurance", pct: 1.2, scope: "construction" },
  { id: "design_contingency", label: "Design contingency", pct: 5.0, scope: "construction" },
  { id: "construction_contingency", label: "Construction contingency", pct: 3.0, scope: "construction" },
  { id: "construction_fee", label: "Construction fees", pct: 3.0, scope: "construction" },
  // Benchmark's cascade stops at construction cost: their Project Total is
  // construction plus escalation, with no A/E fee in it. The bucket exists
  // because other users price one and because Flad's comps are total project
  // cost, but it defaults to zero rather than silently inflating an estimate.
  { id: "design_fees", label: "Design fees", pct: 0, scope: "project" },
] as const;

export const DEFAULT_MARKUPS: MarkupStep[] = BENCHMARK_CASCADE.map((s) => ({ ...s }));

export interface AppliedMarkup extends MarkupStep {
  amount: number;
  /** Subtotal this step was taken against, so the arithmetic can be read back. */
  base: number;
}

/**
 * Run the cascade. Each step compounds on what came before it.
 *
 * Returns every step with the base it was taken against, because "6% of what?"
 * is the first question anyone asks of a markup schedule and the answer should
 * be on the screen rather than in someone's head.
 */
export function applyCascade(base: number, steps: readonly MarkupStep[]): {
  applied: AppliedMarkup[];
  total: number;
} {
  let running = base;
  const applied: AppliedMarkup[] = [];
  for (const step of steps) {
    const amount = running * (step.pct / 100);
    applied.push({ ...step, amount, base: running });
    running += amount;
  }
  return { applied, total: running - base };
}

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
  indirects: AppliedMarkup[];
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
    markups?: MarkupStep[];
    adjustment?: MarketAdjustment;
    band?: BandPoint;
  } = {},
): BottomUpEstimate {
  const markups = opts.markups ?? DEFAULT_MARKUPS;
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

  // The cascade compounds: each step is a percentage of the running subtotal,
  // not of direct cost. Construction-scope steps run first and settle the
  // contract sum; project-scope steps then compound on that.
  const construction_steps = markups.filter((m) => m.scope !== "project");
  const project_steps = markups.filter((m) => m.scope === "project");

  const constructionRun = applyCascade(direct, construction_steps);
  const construction = direct + constructionRun.total;
  const projectRun = applyCascade(construction, project_steps);

  const indirects = [...constructionRun.applied, ...projectRun.applied];
  const indirectTotal = constructionRun.total + projectRun.total;
  const project = construction + projectRun.total;
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

/**
 * Resolve rates and bands once per programme type, then blend by area share.
 *
 * Only bands every contributing type publishes survive the blend. A "per
 * operating room" rate that only the surgery profile carries says nothing
 * about a building that is two thirds medical office, and averaging it against
 * nothing would quietly restate it as the whole building's rate.
 */
async function blendedLookup(
  resolver: CostResolver,
  keys: string[],
  mix: TypeMixEntry[],
  marketId: string | undefined,
): Promise<[Map<string, ResolvedRate>, Map<string, ResolvedBenchmark>]> {
  const parts = await Promise.all(
    mix.map(async (entry) => ({
      entry,
      rates: await resolver.rates(keys, { marketId, typeId: entry.typeId }),
      benchmarks: marketId
        ? await resolver.conceptual({ marketId, typeId: entry.typeId })
        : new Map<string, ResolvedBenchmark>(),
    })),
  );

  const benchmarks = new Map<string, ResolvedBenchmark>();
  const uoms = new Set(parts.flatMap((p) => [...p.benchmarks.keys()]));
  for (const uom of uoms) {
    const hits = parts
      .map((p) => ({ entry: p.entry, resolved: p.benchmarks.get(uom) }))
      .filter((h): h is { entry: TypeMixEntry; resolved: ResolvedBenchmark } => h.resolved != null);
    if (hits.length !== parts.length) continue;
    const benchmark = blendBenchmarks(
      hits.map((h) => ({ entry: h.entry, benchmark: h.resolved.benchmark })),
    );
    if (!benchmark) continue;
    benchmarks.set(uom, {
      benchmark,
      superseded: hits.flatMap((h) => [h.resolved.benchmark, ...h.resolved.superseded]),
    });
  }

  return [blendRates(parts), benchmarks];
}

/** Price a takeoff both ways against whatever sources are registered. */
export async function estimateScheme(
  t: Takeoff,
  resolver: CostResolver,
  opts: {
    marketId?: string;
    typeId?: string;
    markups?: MarkupStep[];
    adjustment?: MarketAdjustment;
    band?: BandPoint;
    /**
     * The programmes inside this building, as shares of gross area. Given two
     * or more distinct types, every rate and the conceptual band are blended
     * across them rather than taken from `typeId` alone.
     */
    mix?: TypeMixEntry[];
  } = {},
): Promise<SchemeEstimate> {
  const keys = Object.keys(t.quantities);
  // A stated mix is authoritative, even when it names a single programme: a
  // scheme nominally typed as an office building whose only programme is a
  // surgery centre should be priced as a surgery centre. At one full-weight
  // entry the blend is a pass-through, so nothing is derived that need not be.
  const mix = normalizeMix(opts.mix ?? []);

  const [rates, benchmarks] = mix.length > 0
    ? await blendedLookup(resolver, keys, mix, opts.marketId)
    : await Promise.all([
        resolver.rates(keys, { marketId: opts.marketId, typeId: opts.typeId }),
        opts.marketId
          ? resolver.conceptual({ marketId: opts.marketId, typeId: opts.typeId })
          : Promise.resolve(new Map<string, ResolvedBenchmark>()),
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
