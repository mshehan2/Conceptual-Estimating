/**
 * The cost source contract.
 *
 * Every provider — the bundled seed library, a DESTINI REST endpoint, a parsed
 * DESTINI export, the user's own overrides — implements this one interface.
 * The estimating engine talks only to the resolver, which talks only to this
 * interface, so adding a live feed is a registration, not a refactor.
 *
 * All methods are async even where the data is already in memory. That is
 * deliberate: it means a synchronous seed source and a networked source are
 * substitutable without touching a single call site.
 */

import type {
  ConceptualBenchmark,
  ConceptualQuery,
  CostIndex,
  IndexQuery,
  SourceKind,
  UnitCostLine,
  UnitCostQuery,
} from "./schema";

/** What a source is able to answer. The UI greys out what a source cannot do. */
export interface SourceCapabilities {
  conceptual: boolean;
  unitCosts: boolean;
  indices: boolean;
  /** True when the source can be refreshed from a remote system of record. */
  refreshable: boolean;
  /** True when values are editable in-app (overrides, imports). */
  writable: boolean;
}

/** Connection state, surfaced in the cost-data panel. */
export type SourceStatus =
  | { state: "ready"; detail?: string }
  | { state: "empty"; detail?: string }
  | { state: "loading"; detail?: string }
  | { state: "error"; detail: string }
  | { state: "unconfigured"; detail?: string };

export interface CostSource {
  readonly id: string;
  readonly kind: SourceKind;
  readonly label: string;
  /**
   * Layering priority. Higher wins in the resolver when two sources answer the
   * same question. Overrides sit highest, seed lowest.
   */
  readonly priority: number;

  capabilities(): SourceCapabilities;
  status(): SourceStatus;

  /** Optional warm-up (fetch a catalog, parse a file). Safe to call repeatedly. */
  init?(): Promise<void>;
  /** Re-pull from the system of record. Only meaningful when `refreshable`. */
  refresh?(): Promise<void>;

  conceptual(query: ConceptualQuery): Promise<ConceptualBenchmark[]>;
  unitCosts(query: UnitCostQuery): Promise<UnitCostLine[]>;
  indices(query: IndexQuery): Promise<CostIndex | null>;
}

/** Priority bands, so sources register at a sane level without guessing. */
export const PRIORITY = {
  seed: 10,
  import: 50,
  liveApi: 70,
  override: 100,
} as const;

/** Convenience base implementing the "I can't do that" answers. */
export abstract class BaseCostSource implements CostSource {
  abstract readonly id: string;
  abstract readonly kind: SourceKind;
  abstract readonly label: string;
  abstract readonly priority: number;

  capabilities(): SourceCapabilities {
    return { conceptual: false, unitCosts: false, indices: false, refreshable: false, writable: false };
  }
  async init(): Promise<void> {
    /* nothing to warm up by default */
  }
  async refresh(): Promise<void> {
    /* not refreshable by default */
  }
  status(): SourceStatus {
    return { state: "ready" };
  }
  async conceptual(_query: ConceptualQuery): Promise<ConceptualBenchmark[]> {
    return [];
  }
  async unitCosts(_query: UnitCostQuery): Promise<UnitCostLine[]> {
    return [];
  }
  async indices(_query: IndexQuery): Promise<CostIndex | null> {
    return null;
  }
}
