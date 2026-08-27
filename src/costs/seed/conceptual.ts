/**
 * Seed conceptual benchmarks — one row per building type.
 *
 * These are planning-level ranges assembled from published industry cost
 * guidance, stated at index 100 (US national average) and priced at the date
 * below. They exist so the app is useful on day one and so the shape of the
 * DESTINI feed is exercised end to end. They are NOT DESTINI data: every row
 * carries `confidence: "low"` and a basis note saying so, and the moment a
 * DESTINI source is connected it outranks all of this by priority.
 *
 * Columns, in order:
 *   typeId, $/GSF low|likely|high, capacity UOM, $/capacity low|likely|high,
 *   GSF per capacity unit, typical efficiency
 */

import type { ConceptualBenchmark, CostScope, Uom } from "../schema";

export const SEED_PRICED_AT = "2026-01-01";
export const SEED_INDEX_BASIS = 100;
export const SEED_SCOPE: CostScope = "construction";

/** Compact authoring row; expanded into full benchmarks below. */
type Row = [
  typeId: string,
  psfLow: number,
  psfLikely: number,
  psfHigh: number,
  capUom: Uom | null,
  capLow: number,
  capLikely: number,
  capHigh: number,
  gsfPerCapacity: number,
  efficiency: number,
];

const ROWS: Row[] = [
  // --- Senior living ---
  ["sl_il", 250, 308, 372, "UNIT", 262_000, 323_000, 391_000, 1050, 0.74],
  ["sl_al", 288, 352, 424, "UNIT", 216_000, 264_000, 318_000, 750, 0.68],
  ["sl_mc", 300, 366, 440, "UNIT", 180_000, 220_000, 264_000, 600, 0.62],
  ["sl_snf", 340, 416, 500, "BED", 211_000, 258_000, 310_000, 620, 0.58],
  ["sl_ccrc", 275, 340, 412, "UNIT", 261_000, 323_000, 391_000, 950, 0.7],
  ["sl_affordable", 200, 246, 296, "UNIT", 160_000, 197_000, 237_000, 800, 0.79],

  // --- Healthcare ---
  ["hc_mob", 280, 346, 420, null, 0, 0, 0, 0, 0.68],
  ["hc_asc", 450, 558, 688, "EA", 1_440_000, 1_786_000, 2_202_000, 3200, 0.56],
  ["hc_clinic", 330, 410, 500, "EA", 182_000, 226_000, 275_000, 550, 0.66],
  ["hc_bedtower", 650, 826, 1010, "BED", 520_000, 661_000, 808_000, 800, 0.52],
  ["hc_ed", 600, 752, 920, "EA", 372_000, 466_000, 570_000, 620, 0.52],
  ["hc_imaging", 480, 600, 740, "EA", 960_000, 1_200_000, 1_480_000, 2000, 0.58],
  ["hc_behavioral", 400, 496, 600, "BED", 248_000, 308_000, 372_000, 620, 0.56],

  // --- Higher education ---
  ["he_residence", 300, 372, 450, "BED", 96_000, 119_000, 144_000, 320, 0.7],
  ["he_academic", 380, 470, 570, null, 0, 0, 0, 0, 0.65],
  ["he_lab", 450, 570, 700, null, 0, 0, 0, 0, 0.58],
  ["he_student_life", 420, 522, 640, null, 0, 0, 0, 0, 0.66],
  ["he_athletics", 380, 470, 580, null, 0, 0, 0, 0, 0.75],
  ["he_library", 400, 496, 606, null, 0, 0, 0, 0, 0.72],

  // --- Multifamily ---
  ["mf_garden", 165, 206, 250, "UNIT", 173_000, 216_000, 263_000, 1050, 0.85],
  ["mf_wrap", 195, 240, 290, "UNIT", 211_000, 259_000, 313_000, 1080, 0.82],
  ["mf_podium", 240, 296, 360, "UNIT", 269_000, 332_000, 403_000, 1120, 0.8],
  ["mf_highrise", 330, 410, 500, "UNIT", 380_000, 472_000, 575_000, 1150, 0.76],
  ["mf_affordable", 185, 226, 274, "UNIT", 196_000, 240_000, 290_000, 1060, 0.83],
  ["mf_townhome", 155, 190, 230, "UNIT", 271_000, 333_000, 403_000, 1750, 0.9],

  // --- Hospitality ---
  ["hp_select", 230, 286, 350, "KEY", 110_000, 137_000, 168_000, 480, 0.75],
  ["hp_extended", 225, 276, 336, "KEY", 113_000, 138_000, 168_000, 500, 0.77],
  ["hp_full", 380, 470, 576, "KEY", 266_000, 329_000, 403_000, 700, 0.66],
  ["hp_boutique", 400, 500, 616, "KEY", 288_000, 360_000, 444_000, 720, 0.66],

  // --- Workplace ---
  ["wk_shell", 230, 286, 350, null, 0, 0, 0, 0, 0.87],
  ["wk_fitout", 110, 150, 200, null, 0, 0, 0, 0, 0.85],
  ["wk_flex", 180, 226, 280, null, 0, 0, 0, 0, 0.86],

  // --- Industrial ---
  ["in_warehouse", 75, 96, 120, null, 0, 0, 0, 0, 0.95],
  ["in_manufacturing", 130, 166, 206, null, 0, 0, 0, 0, 0.92],
  ["in_cold", 220, 280, 350, null, 0, 0, 0, 0, 0.94],

  // --- Civic ---
  ["cv_k12", 320, 396, 480, "STUDENT", 52_800, 65_300, 79_200, 165, 0.65],
  ["cv_worship", 300, 370, 456, "SEAT", 8400, 10_400, 12_800, 28, 0.7],
  ["cv_municipal", 400, 496, 606, null, 0, 0, 0, 0, 0.67],
  ["cv_recreation", 350, 430, 530, null, 0, 0, 0, 0, 0.74],

  // --- Parking ---
  ["pk_garage", 70, 88, 110, "STALL", 23_800, 29_900, 37_400, 340, 0.98],
  ["pk_below", 130, 166, 206, "STALL", 49_400, 63_100, 78_300, 380, 0.96],
  ["pk_surface", 6, 9, 12, "STALL", 2000, 3100, 4100, 340, 1.0],
];

const marketOf = (typeId: string) => typeId.split("_")[0];

const MARKET_PREFIX: Record<string, string> = {
  sl: "senior_living",
  hc: "healthcare",
  he: "higher_ed",
  mf: "multifamily",
  hp: "hospitality",
  wk: "workplace",
  in: "industrial",
  cv: "civic",
  pk: "parking",
};

const BASIS =
  "Seed planning range from published industry cost guidance. Not DESTINI data — connect a DESTINI source to supersede.";

export const SEED_CONCEPTUAL: ConceptualBenchmark[] = ROWS.flatMap((row) => {
  const [typeId, psfLow, psfLikely, psfHigh, capUom, capLow, capLikely, capHigh, gsfPerCapacity, efficiency] = row;
  const marketId = MARKET_PREFIX[marketOf(typeId)];
  const common = {
    marketId,
    typeId,
    scope: SEED_SCOPE,
    indexBasis: SEED_INDEX_BASIS,
    pricedAt: SEED_PRICED_AT,
    efficiency,
    provenance: {
      sourceId: "seed",
      sourceLabel: "BUD seed library",
      sourceKind: "seed" as const,
      asOf: SEED_PRICED_AT,
      basis: BASIS,
      confidence: "low" as const,
    },
  };

  const out: ConceptualBenchmark[] = [
    {
      ...common,
      id: `seed:${typeId}:GSF`,
      uom: "GSF",
      low: psfLow,
      likely: psfLikely,
      high: psfHigh,
      gsfPerCapacity: gsfPerCapacity || undefined,
      label: "Construction cost per gross SF",
    },
  ];

  if (capUom && capLikely > 0) {
    out.push({
      ...common,
      id: `seed:${typeId}:${capUom}`,
      uom: capUom,
      low: capLow,
      likely: capLikely,
      high: capHigh,
      gsfPerCapacity: gsfPerCapacity || undefined,
      label: `Construction cost per ${capUom.toLowerCase()}`,
    });
  }

  return out;
});
