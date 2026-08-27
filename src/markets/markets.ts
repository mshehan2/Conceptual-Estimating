import type { MarketDef } from "./types";

/**
 * The market layer — the first axis you iterate a project on.
 * Ordered as the sector list a Mid-Atlantic builder actually pursues.
 */
export const MARKETS: MarketDef[] = [
  {
    id: "senior_living",
    label: "Senior Living",
    short: "SL",
    description:
      "Independent living through skilled nursing, standalone or as a life-plan campus. Unit-driven, high repetition, amenity-heavy.",
    color: "#4a7ba6",
    typeIds: ["sl_il", "sl_al", "sl_mc", "sl_snf", "sl_ccrc", "sl_affordable"],
  },
  {
    id: "healthcare",
    label: "Healthcare",
    short: "HC",
    description:
      "Outpatient through acute care. Room-driven program, heavy MEP, high infrastructure and equipment content.",
    color: "#6a9e8f",
    typeIds: ["hc_mob", "hc_asc", "hc_clinic", "hc_bedtower", "hc_ed", "hc_imaging", "hc_behavioral"],
  },
  {
    id: "higher_ed",
    label: "Higher Education",
    short: "HE",
    description:
      "Campus work: housing, instruction, research, and student life. Schedule-constrained by the academic calendar.",
    color: "#8a7ba6",
    typeIds: ["he_residence", "he_academic", "he_lab", "he_student_life", "he_athletics", "he_library"],
  },
  {
    id: "multifamily",
    label: "Multifamily",
    short: "MF",
    description:
      "Market-rate and affordable housing. The most cost-sensitive market — structure type and parking strategy drive the number.",
    color: "#b08d57",
    typeIds: ["mf_garden", "mf_wrap", "mf_podium", "mf_highrise", "mf_affordable", "mf_townhome"],
  },
  {
    id: "hospitality",
    label: "Hospitality",
    short: "HP",
    description: "Keyed products from select service to full service. Brand standards drive FF&E and finish level.",
    color: "#c4894d",
    typeIds: ["hp_select", "hp_extended", "hp_full", "hp_boutique"],
  },
  {
    id: "workplace",
    label: "Workplace & Commercial",
    short: "WK",
    description: "Core-and-shell, tenant fit-out, and flex/R&D. Shell and TI are priced and carried separately.",
    color: "#5f8aa6",
    typeIds: ["wk_shell", "wk_fitout", "wk_flex"],
  },
  {
    id: "industrial",
    label: "Industrial",
    short: "IN",
    description: "Distribution, light manufacturing, and cold storage. Low $/SF, high sensitivity to site and slab.",
    color: "#8a8f98",
    typeIds: ["in_warehouse", "in_manufacturing", "in_cold"],
  },
  {
    id: "civic",
    label: "Civic & Community",
    short: "CV",
    description: "K-12, worship, municipal, and recreation. Public procurement, prevailing wage, long approvals.",
    color: "#a0654f",
    typeIds: ["cv_k12", "cv_worship", "cv_municipal", "cv_recreation"],
  },
  {
    id: "parking",
    label: "Parking",
    short: "PK",
    description: "Structured and below-grade parking, priced per stall and usually carried as a separate scope.",
    color: "#6f7d89",
    typeIds: ["pk_garage", "pk_below", "pk_surface"],
  },
];

export const MARKET_BY_ID: Record<string, MarketDef> = Object.fromEntries(
  MARKETS.map((m) => [m.id, m]),
);
