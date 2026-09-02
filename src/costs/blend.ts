/**
 * Blending one building's rates across the programmes inside it.
 *
 * A medical office building with an ambulatory surgery centre in it is one
 * building and two cost profiles. The office side runs a normal outpatient
 * HVAC load; the surgery side runs operating room air at several times that.
 * Pricing the whole thing at either type's rates is wrong in a direction you
 * can predict and by an amount you cannot.
 *
 * So the mix is stated as shares of building gross area and every rate is the
 * share-weighted average of what each type's own profile answers. The seed
 * library scales its whole catalog per type, so both types answer every key
 * and the weights sum to one: a 70/30 MOB/ASC building reads 0.7 of the MOB
 * rate plus 0.3 of the ASC rate, which is exactly the arithmetic an estimator
 * does by hand when they carve a surgery floor out of an office shell.
 *
 * The blend is marked derived and carries the mix in its note, so nothing
 * downstream can mistake it for a published number.
 */

import type { ConceptualBenchmark, Confidence, Provenance, UnitCostLine } from "./schema";
import { CONFIDENCE_RANK } from "./schema";
import type { ResolvedRate } from "./resolver";

/** One programme's claim on the building, as a share of gross area. */
export interface TypeMixEntry {
  typeId: string;
  label: string;
  /** Share of building gross area, 0..1. */
  share: number;
}

/** Normalize a mix to shares that sum to 1, dropping anything empty. */
export function normalizeMix(mix: TypeMixEntry[]): TypeMixEntry[] {
  const kept = mix.filter((m) => m.share > 0 && m.typeId);
  const total = kept.reduce((a, m) => a + m.share, 0);
  if (total <= 0) return [];
  // Fold repeats of the same type together so a building with two office
  // programmes weighs the office profile once, at their combined share.
  const byType = new Map<string, TypeMixEntry>();
  for (const m of kept) {
    const at = byType.get(m.typeId);
    if (at) at.share += m.share / total;
    else byType.set(m.typeId, { ...m, share: m.share / total });
  }
  return [...byType.values()].sort((a, b) => b.share - a.share);
}

/** "68% Medical office building, 32% Ambulatory surgery centre" */
export function describeMix(mix: TypeMixEntry[]): string {
  return mix.map((m) => `${Math.round(m.share * 100)}% ${m.label}`).join(", ");
}

function weakest(confidences: Confidence[]): Confidence {
  return confidences.reduce((a, c) => (CONFIDENCE_RANK[c] < CONFIDENCE_RANK[a] ? c : a), "high");
}

function blendProvenance(parts: { share: number; provenance: Provenance }[], mixNote: string): Provenance {
  const lead = parts[0].provenance;
  const samples = parts.map((p) => p.provenance.sampleSize).filter((n): n is number => n != null);
  return {
    ...lead,
    derived: true,
    confidence: weakest(parts.map((p) => p.provenance.confidence)),
    // The smallest sample behind any contributor governs the blend: mixing a
    // 40-project rate with a 2-project one does not produce a 42-project rate.
    sampleSize: samples.length === parts.length ? Math.min(...samples) : undefined,
    note: `Blended ${mixNote}${lead.note ? ` — ${lead.note}` : ""}`,
  };
}

/**
 * Share-weighted blend of the same rate key across several building types.
 *
 * A key only one type answers still blends: it enters at that type's share,
 * because the quantity it prices is building-wide. An operating room air
 * handling premium that only the surgery profile carries should be paid on the
 * surgery share of the building, not on all of it.
 */
export function blendRates(
  parts: { entry: TypeMixEntry; rates: Map<string, ResolvedRate> }[],
): Map<string, ResolvedRate> {
  const mixNote = describeMix(parts.map((p) => p.entry));
  const keys = new Set<string>();
  for (const p of parts) for (const k of p.rates.keys()) keys.add(k);

  const out = new Map<string, ResolvedRate>();
  for (const key of keys) {
    const hits = parts
      .map((p) => ({ share: p.entry.share, rate: p.rates.get(key) }))
      .filter((h): h is { share: number; rate: ResolvedRate } => h.rate != null);
    if (hits.length === 0) continue;

    // One contributor and full weight is not a blend; pass it through so its
    // provenance stays the published one.
    if (hits.length === 1 && hits[0].share >= 0.999) {
      out.set(key, hits[0].rate);
      continue;
    }

    const lead = hits.reduce((a, h) => (h.share > a.share ? h : a)).rate.line;
    const w = (pick: (l: UnitCostLine) => number) =>
      hits.reduce((a, h) => a + h.share * pick(h.rate.line), 0);

    out.set(key, {
      key,
      line: {
        ...lead,
        id: `${lead.key}:blend`,
        typeId: undefined,
        low: w((l) => l.low),
        likely: w((l) => l.likely),
        high: w((l) => l.high),
        provenance: blendProvenance(
          hits.map((h) => ({ share: h.share, provenance: h.rate.line.provenance })),
          mixNote,
        ),
      },
      superseded: hits.reduce((a, h) => (h.share > a.share ? h : a)).rate.superseded,
    });
  }
  return out;
}

/**
 * Share-weighted blend of a conceptual band.
 *
 * Reconciling a mixed building against one type's published band is comparing
 * it to a building that was never proposed. The blended band is what the
 * market would say about this mix, and it is the only fair check on the
 * blended bottom-up.
 */
export function blendBenchmarks(
  parts: { entry: TypeMixEntry; benchmark: ConceptualBenchmark }[],
): ConceptualBenchmark | null {
  if (parts.length === 0) return null;
  if (parts.length === 1 && parts[0].entry.share >= 0.999) return parts[0].benchmark;

  const total = parts.reduce((a, p) => a + p.entry.share, 0);
  if (total <= 0) return null;
  const w = (pick: (b: ConceptualBenchmark) => number) =>
    parts.reduce((a, p) => a + (p.entry.share / total) * pick(p.benchmark), 0);

  const lead = parts.reduce((a, p) => (p.entry.share > a.entry.share ? p : a));
  const effs = parts.filter((p) => p.benchmark.efficiency != null);

  return {
    ...lead.benchmark,
    id: `${lead.benchmark.id}:blend`,
    typeId: undefined,
    label: `Blended — ${describeMix(parts.map((p) => p.entry))}`,
    low: w((b) => b.low),
    likely: w((b) => b.likely),
    high: w((b) => b.high),
    efficiency:
      effs.length === parts.length
        ? w((b) => b.efficiency ?? 0)
        : lead.benchmark.efficiency,
    provenance: blendProvenance(
      parts.map((p) => ({ share: p.entry.share, provenance: p.benchmark.provenance })),
      describeMix(parts.map((p) => p.entry)),
    ),
  };
}
