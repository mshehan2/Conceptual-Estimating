/**
 * The cost resolver — the only thing the estimating engine talks to.
 *
 * Registered sources are layered by priority: overrides beat a live DESTINI
 * feed, which beats an imported export, which beats the seed library. The
 * resolver asks every source that can answer, keeps the highest-priority
 * response, and records the ones it passed over so the UI can show what a
 * number would have been under a different source.
 */

import type { CostSource } from "./source";
import type {
  ConceptualBenchmark,
  ConceptualQuery,
  CostIndex,
  GeoScope,
  IndexQuery,
  UnitCostLine,
  UnitCostQuery,
} from "./schema";

/** A resolved rate plus everything the resolver chose not to use. */
export interface ResolvedRate {
  key: string;
  line: UnitCostLine;
  /** Lower-priority answers for the same key, highest priority first. */
  superseded: UnitCostLine[];
}

export interface ResolvedBenchmark {
  benchmark: ConceptualBenchmark;
  superseded: ConceptualBenchmark[];
}

export interface ResolverSnapshot {
  sources: { id: string; label: string; priority: number; state: string; detail?: string }[];
}

export class CostResolver {
  private sources: CostSource[] = [];

  register(source: CostSource): this {
    this.sources = [...this.sources.filter((s) => s.id !== source.id), source].sort(
      (a, b) => b.priority - a.priority,
    );
    return this;
  }

  unregister(id: string): this {
    this.sources = this.sources.filter((s) => s.id !== id);
    return this;
  }

  get(id: string): CostSource | undefined {
    return this.sources.find((s) => s.id === id);
  }

  list(): CostSource[] {
    return [...this.sources];
  }

  snapshot(): ResolverSnapshot {
    return {
      sources: this.sources.map((s) => {
        const st = s.status();
        return { id: s.id, label: s.label, priority: s.priority, state: st.state, detail: st.detail };
      }),
    };
  }

  async initAll(): Promise<void> {
    await Promise.all(this.sources.map((s) => s.init?.().catch(() => undefined)));
  }

  /**
   * Resolve rate keys. Sources are queried in parallel; the highest-priority
   * source that returns a line for a key wins it.
   */
  async rates(keys: string[], scopeQuery: Omit<UnitCostQuery, "keys"> = {}): Promise<Map<string, ResolvedRate>> {
    const capable = this.sources.filter((s) => s.capabilities().unitCosts);
    const results = await Promise.all(
      capable.map(async (s) => {
        try {
          return { source: s, lines: await s.unitCosts({ ...scopeQuery, keys }) };
        } catch {
          return { source: s, lines: [] as UnitCostLine[] };
        }
      }),
    );

    // `capable` is already priority-sorted, so the first hit for a key wins and
    // everything after it is recorded as superseded.
    const out = new Map<string, ResolvedRate>();
    for (const { lines } of results) {
      for (const line of lines) {
        const existing = out.get(line.key);
        if (!existing) out.set(line.key, { key: line.key, line, superseded: [] });
        else existing.superseded.push(line);
      }
    }
    return out;
  }

  /** Resolve every rate key any source knows about. */
  async allRates(scopeQuery: Omit<UnitCostQuery, "keys"> = {}): Promise<Map<string, ResolvedRate>> {
    const capable = this.sources.filter((s) => s.capabilities().unitCosts);
    const results = await Promise.all(
      capable.map(async (s) => {
        try {
          return await s.unitCosts(scopeQuery);
        } catch {
          return [] as UnitCostLine[];
        }
      }),
    );
    const out = new Map<string, ResolvedRate>();
    for (const lines of results) {
      for (const line of lines) {
        const existing = out.get(line.key);
        if (!existing) out.set(line.key, { key: line.key, line, superseded: [] });
        else existing.superseded.push(line);
      }
    }
    return out;
  }

  /**
   * Conceptual benchmarks for a market/type. Returns the best answer per unit
   * of measure, so a caller gets both the $/GSF and the $/unit figure.
   */
  async conceptual(query: ConceptualQuery): Promise<Map<string, ResolvedBenchmark>> {
    const capable = this.sources.filter((s) => s.capabilities().conceptual);
    const results = await Promise.all(
      capable.map(async (s) => {
        try {
          return await s.conceptual(query);
        } catch {
          return [] as ConceptualBenchmark[];
        }
      }),
    );

    const out = new Map<string, ResolvedBenchmark>();
    for (const list of results) {
      for (const b of list) {
        // A type-specific row always beats a market-wide row from the same tier.
        const existing = out.get(b.uom);
        if (!existing) {
          out.set(b.uom, { benchmark: b, superseded: [] });
        } else if (!existing.benchmark.typeId && b.typeId && sameTier(existing.benchmark, b)) {
          out.set(b.uom, { benchmark: b, superseded: [existing.benchmark, ...existing.superseded] });
        } else {
          existing.superseded.push(b);
        }
      }
    }
    return out;
  }

  /** Location index and escalation for a geography. */
  async index(geo: GeoScope, midpoint?: string): Promise<CostIndex | null> {
    const capable = this.sources.filter((s) => s.capabilities().indices);
    const query: IndexQuery = { geo, midpoint };
    for (const s of capable) {
      try {
        const hit = await s.indices(query);
        if (hit) return hit;
      } catch {
        /* try the next source */
      }
    }
    return null;
  }
}

const sameTier = (a: ConceptualBenchmark, b: ConceptualBenchmark) =>
  a.provenance.sourceId === b.provenance.sourceId;

// ---------------------------------------------------------------------------
// Escalation & indexing
// ---------------------------------------------------------------------------

/** Compound escalation from a priced-at date to a construction midpoint. */
export function escalationFactor(pricedAt: string, midpoint: string | undefined, pctPerYear: number): number {
  if (!midpoint || pctPerYear <= 0) return 1;
  const from = Date.parse(pricedAt + (pricedAt.length === 10 ? "T12:00:00Z" : ""));
  const to = Date.parse(midpoint + (midpoint.length === 10 ? "T12:00:00Z" : ""));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 1;
  const years = (to - from) / (365.25 * 86_400_000);
  return Math.pow(1 + pctPerYear / 100, years);
}

/** Location factor relative to the basis a rate is stated at. */
export function locationFactor(indexBasis: number, targetIndex: number): number {
  if (!Number.isFinite(indexBasis) || indexBasis <= 0) return 1;
  return targetIndex / indexBasis;
}
