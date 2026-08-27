/**
 * Market registry — lookups and integrity checks over the market → type →
 * unit graph. `validateRegistry` runs in tests and in dev so a bad ref is
 * caught at build time rather than as an empty program in the UI.
 */

import { BUILDING_TYPES } from "./buildingTypes";
import { MARKETS, MARKET_BY_ID } from "./markets";
import { UNIT_BY_REF, UNIT_CATALOG, unitArea } from "./unitCatalog";
import type { BuildingTypeDef, MarketDef } from "./types";

export { BUILDING_TYPES, MARKETS, MARKET_BY_ID, UNIT_BY_REF, UNIT_CATALOG, unitArea };
export type { BuildingTypeDef, MarketDef };

export const TYPE_BY_ID: Record<string, BuildingTypeDef> = Object.fromEntries(
  BUILDING_TYPES.map((t) => [t.id, t]),
);

export const typesForMarket = (marketId: string): BuildingTypeDef[] => {
  const market = MARKET_BY_ID[marketId];
  if (!market) return [];
  // Ordered by the market's own typeIds so the menu reads the way it was authored.
  return market.typeIds.map((id) => TYPE_BY_ID[id]).filter(Boolean);
};

export const marketForType = (typeId: string): MarketDef | undefined => {
  const t = TYPE_BY_ID[typeId];
  return t ? MARKET_BY_ID[t.marketId] : undefined;
};

/** Human path for a type, e.g. "Senior Living / Assisted Living". */
export const typePath = (typeId: string): string => {
  const t = TYPE_BY_ID[typeId];
  if (!t) return "";
  return `${MARKET_BY_ID[t.marketId]?.label ?? t.marketId} / ${t.label}`;
};

export interface RegistryProblem {
  where: string;
  problem: string;
}

/** Structural integrity of the registry. Empty array means healthy. */
export function validateRegistry(): RegistryProblem[] {
  const problems: RegistryProblem[] = [];

  const seenTypeIds = new Set<string>();
  for (const t of BUILDING_TYPES) {
    if (seenTypeIds.has(t.id)) problems.push({ where: t.id, problem: "duplicate building type id" });
    seenTypeIds.add(t.id);

    if (!MARKET_BY_ID[t.marketId]) {
      problems.push({ where: t.id, problem: `unknown marketId "${t.marketId}"` });
    } else if (!MARKET_BY_ID[t.marketId].typeIds.includes(t.id)) {
      problems.push({ where: t.id, problem: `not listed in market "${t.marketId}" typeIds` });
    }

    for (const ref of t.unitRefs) {
      if (!UNIT_BY_REF[ref]) problems.push({ where: t.id, problem: `unitRefs -> unknown unit "${ref}"` });
    }
    for (const m of t.programMix) {
      if (!UNIT_BY_REF[m.unitRef]) problems.push({ where: t.id, problem: `programMix -> unknown unit "${m.unitRef}"` });
    }
    for (const s of t.supportSpaces ?? []) {
      if (!UNIT_BY_REF[s.unitRef]) problems.push({ where: t.id, problem: `supportSpaces -> unknown unit "${s.unitRef}"` });
    }

    const mixTotal = t.programMix.reduce((a, m) => a + m.share, 0);
    if (t.programMix.length && Math.abs(mixTotal - 1) > 0.02) {
      problems.push({ where: t.id, problem: `programMix shares sum to ${mixTotal.toFixed(3)}, expected 1.0` });
    }

    const e = t.efficiency;
    if (!(e.low <= e.typical && e.typical <= e.high && e.low > 0 && e.high <= 1)) {
      problems.push({ where: t.id, problem: "efficiency band is not 0 < low <= typical <= high <= 1" });
    }
  }

  for (const m of MARKETS) {
    for (const id of m.typeIds) {
      if (!TYPE_BY_ID[id]) problems.push({ where: m.id, problem: `typeIds -> unknown building type "${id}"` });
    }
  }

  const seenRefs = new Set<string>();
  for (const u of UNIT_CATALOG) {
    if (seenRefs.has(u.ref)) problems.push({ where: u.ref, problem: "duplicate unit ref" });
    seenRefs.add(u.ref);
    if (unitArea(u) <= 0) problems.push({ where: u.ref, problem: "non-positive area" });
  }

  return problems;
}
