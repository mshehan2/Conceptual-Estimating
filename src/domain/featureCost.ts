/**
 * Per-feature pricing.
 *
 * A feature editor that only edits parameters is a form. What makes it worth
 * using is seeing what each move costs while you make it — so a canopy, a
 * balcony run and a green roof can be argued about in dollars rather than in
 * adjectives.
 *
 * The number reported here is the feature's OWN priced lines. Features also
 * adjust the shell around them — a bay adds envelope, a loggia removes plate —
 * and those land in the shell and structure divisions where they belong rather
 * than being double counted here. `envelopeEffect` reports that separately so
 * the editor can say so out loud instead of quietly understating a move.
 */

import type { CostResolver } from "@/costs/resolver";
import { escalationFactor, locationFactor } from "@/costs/resolver";
import type { MarketAdjustment, BandPoint } from "./estimate";
import { DEFAULT_ADJUSTMENT } from "./estimate";
import { FEATURE_LABELS, featureTakeoff, type Feature } from "./features";
import { massFootprint, massSegments, type Mass } from "./massing";
import { footprintPerimeter } from "./footprint";
import type { Uom } from "@/costs/schema";

export interface FeatureCostLine {
  key: string;
  label: string;
  quantity: number;
  uom: Uom;
  rate: number;
  amount: number;
}

export interface FeatureCost {
  featureId: string;
  label: string;
  /** Direct cost of this feature's own lines. */
  amount: number;
  lines: FeatureCostLine[];
  /**
   * How this feature changes the shell around it, in square feet.
   * Priced in the shell divisions, not here, so the two never double count.
   */
  envelopeEffect: { wall: number; glazing: number; plate: number };
  /** Rate keys no source could price, so a zero is never mistaken for free. */
  unpriced: string[];
}

export async function priceFeatures(
  mass: Mass,
  resolver: CostResolver,
  opts: { marketId?: string; typeId?: string; adjustment?: MarketAdjustment; band?: BandPoint } = {},
): Promise<FeatureCost[]> {
  const features = mass.features ?? [];
  if (!features.length) return [];

  const adjustment = opts.adjustment ?? DEFAULT_ADJUSTMENT;
  const band = opts.band ?? "likely";
  const plan = massFootprint(mass);
  const ctx = {
    segments: massSegments(mass),
    floors: mass.floors,
    floorToFloor: mass.fth,
    roofPerimeter: footprintPerimeter(plan),
  };

  // One takeoff per feature, then a single rate lookup across all of them.
  const takeoffs = features.map((feature) => ({ feature, result: featureTakeoff(feature, ctx) }));
  const keys = [...new Set(takeoffs.flatMap((t) => Object.keys(t.result.quantities)))];
  const rates = await resolver.rates(keys, { marketId: opts.marketId, typeId: opts.typeId });

  return takeoffs.map(({ feature, result }) => {
    const lines: FeatureCostLine[] = [];
    const unpriced: string[] = [];

    for (const [key, quantity] of Object.entries(result.quantities)) {
      if (!quantity) continue;
      const resolved = rates.get(key);
      if (!resolved) {
        unpriced.push(key);
        continue;
      }
      const line = resolved.line;
      const rate =
        line[band] *
        locationFactor(line.indexBasis, adjustment.locationIndex) *
        escalationFactor(line.pricedAt, adjustment.midpoint, adjustment.escalationPctPerYear);

      lines.push({ key, label: line.label, quantity, uom: line.uom, rate, amount: rate * quantity });
    }

    lines.sort((a, b) => b.amount - a.amount);

    return {
      featureId: feature.id,
      label: FEATURE_LABELS[feature.kind],
      amount: lines.reduce((a, l) => a + l.amount, 0),
      lines,
      envelopeEffect: {
        wall: result.wallDelta,
        glazing: result.glazingDelta,
        plate: result.plateDelta,
      },
      unpriced,
    };
  });
}

/** Total direct cost of every enabled feature on a mass. */
export const totalFeatureCost = (costs: FeatureCost[]): number =>
  costs.reduce((a, c) => a + c.amount, 0);

export type { Feature };
