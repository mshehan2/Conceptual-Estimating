/**
 * The bundled seed library as a `CostSource`.
 *
 * Lowest priority of any source: it answers when nothing better is connected,
 * and steps aside the moment a DESTINI import or endpoint is registered.
 */

import { BaseCostSource, PRIORITY, type SourceCapabilities, type SourceStatus } from "../source";
import type {
  ConceptualBenchmark,
  ConceptualQuery,
  CostIndex,
  IndexQuery,
  SourceKind,
  UnitCostLine,
  UnitCostQuery,
} from "../schema";
import { SEED_CONCEPTUAL, SEED_PRICED_AT } from "../seed/conceptual";
import { SEED_UNIT_COSTS } from "../seed/unitCosts";
import { cityIndex, nearestCity } from "../seed/locations";

/** National-average escalation assumption when the source has nothing better. */
const DEFAULT_ESCALATION_PCT = 4;

export class SeedCostSource extends BaseCostSource {
  readonly id = "seed";
  readonly kind: SourceKind = "seed";
  readonly label = "BUD seed library";
  readonly priority = PRIORITY.seed;

  override capabilities(): SourceCapabilities {
    return { conceptual: true, unitCosts: true, indices: true, refreshable: false, writable: false };
  }

  override status(): SourceStatus {
    return {
      state: "ready",
      detail: `${SEED_CONCEPTUAL.length} benchmarks · ${SEED_UNIT_COSTS.length} rates · priced ${SEED_PRICED_AT}`,
    };
  }

  override async conceptual(query: ConceptualQuery): Promise<ConceptualBenchmark[]> {
    return SEED_CONCEPTUAL.filter((b) => {
      if (query.marketId && b.marketId !== query.marketId) return false;
      // A type-specific ask also accepts market-wide rows, which carry no typeId.
      if (query.typeId && b.typeId && b.typeId !== query.typeId) return false;
      if (query.scope && b.scope !== query.scope) return false;
      if (query.uom && b.uom !== query.uom) return false;
      return true;
    });
  }

  override async unitCosts(query: UnitCostQuery): Promise<UnitCostLine[]> {
    const wanted = query.keys ? new Set(query.keys) : null;
    return SEED_UNIT_COSTS.filter((r) => {
      if (wanted && !wanted.has(r.key)) return false;
      if (query.marketId && r.marketId && r.marketId !== query.marketId) return false;
      if (query.typeId && r.typeId && r.typeId !== query.typeId) return false;
      return true;
    });
  }

  override async indices(query: IndexQuery): Promise<CostIndex | null> {
    const { geo } = query;
    const byName = geo.city ? cityIndex(geo.city) : undefined;
    const byPoint =
      !byName && geo.lat != null && geo.lon != null ? nearestCity(geo.lat, geo.lon) : null;
    const match = byName ?? byPoint;
    if (!match) return null;

    const miles = byPoint ? byPoint.miles : 0;
    return {
      location: match.index,
      escalationPctPerYear: DEFAULT_ESCALATION_PCT,
      city: match.city,
      provenance: {
        sourceId: this.id,
        sourceLabel: this.label,
        sourceKind: this.kind,
        asOf: SEED_PRICED_AT,
        basis: byName
          ? `ENR-style city index for ${match.city}`
          : `ENR-style city index, nearest metro ${match.city} (${miles} mi)`,
        confidence: byName || miles < 40 ? "medium" : "low",
        derived: !byName,
      },
    };
  }
}
