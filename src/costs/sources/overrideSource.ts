/**
 * User overrides — the highest-priority source.
 *
 * When an estimator types a number over a fed rate, that edit is a first-class
 * cost source rather than a mutation of the data underneath. The original value
 * stays intact and visible, the override wins, and the provenance chip says
 * plainly that a person set it.
 */

import { BaseCostSource, PRIORITY, type SourceCapabilities, type SourceStatus } from "../source";
import type {
  ConceptualBenchmark,
  ConceptualQuery,
  SourceKind,
  UnitCostLine,
  UnitCostQuery,
  Uom,
} from "../schema";

export interface RateOverride {
  key: string;
  value: number;
  uom: Uom;
  label?: string;
  /** Who/why, shown in the audit trail. */
  note?: string;
  at: string;
}

export class OverrideCostSource extends BaseCostSource {
  readonly id = "override";
  readonly kind: SourceKind = "override";
  readonly label = "Manual overrides";
  readonly priority = PRIORITY.override;

  private overrides = new Map<string, RateOverride>();

  override capabilities(): SourceCapabilities {
    return { conceptual: false, unitCosts: true, indices: false, refreshable: false, writable: true };
  }

  override status(): SourceStatus {
    const n = this.overrides.size;
    return n
      ? { state: "ready", detail: `${n} rate${n === 1 ? "" : "s"} overridden` }
      : { state: "empty", detail: "No overrides" };
  }

  set(key: string, value: number, uom: Uom, opts: { label?: string; note?: string } = {}): void {
    this.overrides.set(key, {
      key,
      value,
      uom,
      label: opts.label,
      note: opts.note,
      at: new Date().toISOString(),
    });
  }

  clear(key: string): void {
    this.overrides.delete(key);
  }

  clearAll(): void {
    this.overrides.clear();
  }

  has(key: string): boolean {
    return this.overrides.has(key);
  }

  list(): RateOverride[] {
    return [...this.overrides.values()];
  }

  /** Serializable form, for saving with the project. */
  toJSON(): RateOverride[] {
    return this.list();
  }

  loadJSON(rows: RateOverride[] | undefined): void {
    this.overrides.clear();
    for (const r of rows ?? []) {
      if (r && typeof r.key === "string" && Number.isFinite(r.value)) this.overrides.set(r.key, r);
    }
  }

  override async unitCosts(query: UnitCostQuery): Promise<UnitCostLine[]> {
    const wanted = query.keys ? new Set(query.keys) : null;
    return this.list()
      .filter((o) => !wanted || wanted.has(o.key))
      .map((o) => ({
        id: `override:${o.key}`,
        key: o.key,
        label: o.label ?? o.key,
        uom: o.uom,
        low: o.value,
        likely: o.value,
        high: o.value,
        indexBasis: 100,
        pricedAt: o.at.slice(0, 10),
        provenance: {
          sourceId: this.id,
          sourceLabel: this.label,
          sourceKind: this.kind,
          asOf: o.at.slice(0, 10),
          basis: o.note ?? "Set by hand in this project",
          confidence: "high" as const,
        },
      }));
  }

  override async conceptual(_query: ConceptualQuery): Promise<ConceptualBenchmark[]> {
    return [];
  }
}
