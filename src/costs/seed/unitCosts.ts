/**
 * Seed unit-cost catalog — the granular assembly rates the bottom-up takeoff
 * multiplies quantities by.
 *
 * `key` is BUD's stable internal rate key. Keeping it separate from any
 * source's own coding is what lets a seed value, a DESTINI import, and a user
 * override all answer the same question interchangeably. CSI and UNIFORMAT
 * codes are carried so an imported DESTINI line can be matched by code when
 * its key does not map directly.
 *
 * Same caveat as the conceptual seed: planning-level industry ranges, stated
 * at index 100 and marked low confidence, meant to be superseded by a real
 * DESTINI feed.
 */

import type { UnitCostLine, Uom } from "../schema";
import { SEED_INDEX_BASIS, SEED_PRICED_AT } from "./conceptual";

type Row = [
  key: string,
  label: string,
  uom: Uom,
  low: number,
  likely: number,
  high: number,
  csi: string,
  uniformat: string,
];

const ROWS: Row[] = [
  // ---- Substructure (UNIFORMAT A) ----
  ["spread_found", "Spread footings & foundations", "SF", 8, 11, 16, "03 30 00", "A1010"],
  ["deep_found", "Deep foundations (piles / caissons)", "SF", 0, 0, 34, "31 60 00", "A1020"],
  ["slab_grade", "Slab on grade", "SF", 6.5, 8.5, 12, "03 30 00", "A1030"],
  ["excavation", "Excavation & backfill", "CY", 16, 22, 34, "31 20 00", "A2010"],
  ["found_wall", "Foundation / retaining wall", "SF", 38, 48, 66, "03 30 00", "A2020"],
  ["waterproofing", "Below-grade waterproofing", "SF", 10, 14, 20, "07 10 00", "A2020"],

  // ---- Shell: structure (UNIFORMAT B10) ----
  ["elevated_floor", "Elevated floor structure", "SF", 18, 26, 42, "03 30 00", "B1010"],
  ["roof_struct", "Roof structure", "SF", 10, 14, 22, "05 12 00", "B1020"],

  // ---- Shell: exterior enclosure (UNIFORMAT B20) ----
  ["wall_brick", "Brick veneer assembly", "SF", 44, 55, 74, "04 21 00", "B2010"],
  ["wall_fiber_cement", "Fiber cement siding assembly", "SF", 33, 42, 56, "07 46 00", "B2010"],
  ["wall_metal_panel", "Metal panel assembly", "SF", 54, 68, 92, "07 42 00", "B2010"],
  ["wall_stucco", "Stucco assembly", "SF", 35, 45, 60, "09 24 00", "B2010"],
  ["wall_eifs", "EIFS assembly", "SF", 30, 38, 52, "07 24 00", "B2010"],
  ["wall_precast", "Architectural precast", "SF", 50, 62, 84, "03 45 00", "B2010"],
  ["wall_stone", "Stone veneer assembly", "SF", 68, 88, 120, "04 43 00", "B2010"],
  ["wall_wood", "Wood siding assembly", "SF", 36, 46, 62, "07 46 00", "B2010"],
  ["wall_curtain_wall", "Opaque curtain wall spandrel", "SF", 78, 96, 128, "08 44 00", "B2010"],
  ["air_barrier", "Air & weather barrier", "SF", 2.6, 3.5, 5, "07 27 00", "B2010"],
  ["ext_framing", "Exterior backup framing & sheathing", "SF", 7, 9, 13, "05 40 00", "B2010"],
  ["punched", "Punched windows", "SF", 68, 85, 115, "08 51 00", "B2020"],
  ["strip", "Ribbon / strip glazing", "SF", 88, 110, 145, "08 44 00", "B2020"],
  ["curtain", "Curtain wall (vision)", "SF", 128, 160, 215, "08 44 00", "B2020"],

  // ---- Shell: roofing (UNIFORMAT B30) ----
  ["roof", "Low-slope membrane roofing", "SF", 22, 30, 42, "07 54 00", "B3010"],
  ["roof_pitched", "Pitched roofing (shingle / standing seam)", "SF", 9, 12, 19, "07 31 00", "B3010"],

  // ---- Interiors (UNIFORMAT C) ----
  ["partition", "Interior partition (framed, insulated, GWB 2 sides)", "LF", 92, 115, 152, "09 21 16", "C1010"],
  ["int_framing", "Interior framing allowance", "GSF", 10, 14, 20, "09 21 16", "C1010"],
  ["door", "Interior door assembly (leaf, frame, hardware)", "EA", 900, 1150, 1600, "08 14 00", "C1020"],
  ["paint", "Painting & wall finish", "GSF", 1.5, 2, 3, "09 91 00", "C3010"],
  ["ceiling", "Ceiling finish", "GSF", 4.5, 6, 9, "09 51 00", "C3030"],
  ["flooring", "Floor finish", "GSF", 6, 8, 12, "09 65 00", "C3020"],
  ["base_trim", "Base & trim", "GSF", 1.6, 2.2, 3.2, "06 22 00", "C3020"],
  ["cab_base", "Base cabinets", "LF", 205, 260, 350, "12 32 00", "C1030"],
  ["cab_wall", "Wall cabinets", "LF", 150, 190, 255, "12 32 00", "C1030"],
  ["ctop", "Countertops", "LF", 100, 130, 185, "12 36 00", "C1030"],

  // ---- Services (UNIFORMAT D) ----
  ["sprinkler", "Fire suppression", "GSF", 4.2, 5.5, 7.5, "21 13 00", "D4010"],
  ["hvac", "HVAC", "GSF", 22, 30, 46, "23 00 00", "D3050"],
  ["electrical", "Electrical (power, lighting, distribution)", "GSF", 17, 22, 32, "26 00 00", "D5010"],
  ["plumb_fixture", "Plumbing fixture (rough & set)", "EA", 2500, 3200, 4400, "22 40 00", "D2010"],
  ["appliance", "Residential appliance set", "EA", 3200, 4000, 5600, "11 30 00", "E1090"],
  ["elevator_base", "Elevator — base machine & car", "EA", 105_000, 135_000, 185_000, "14 20 00", "D1010"],
  ["elevator_stop", "Elevator — per additional stop", "EA", 11_000, 15_000, 21_000, "14 20 00", "D1010"],
  ["stair_flight", "Egress stair — per flight", "EA", 13_000, 18_000, 26_000, "05 51 00", "B1080"],

  // ---- Sitework (UNIFORMAT G) ----
  ["site_parking", "Surface parking & paving", "SF", 6.5, 9, 13, "32 12 00", "G2020"],
  ["site_patio", "Hardscape / patio", "SF", 10, 14, 21, "32 14 00", "G2030"],
  ["site_basin", "Stormwater basin", "SF", 4, 6, 9.5, "33 40 00", "G3030"],
  ["site_lawn", "Lawn & landscape", "SF", 2, 3, 5, "32 90 00", "G2050"],
  ["parking_stall", "Structured parking stall (all-in)", "STALL", 23_800, 29_900, 37_400, "03 41 00", "G2020"],

  // ---- Unit fit-out premiums, $/SF of unit area ----
  // These sit on top of the base interior/MEP rates and capture what makes a
  // given space type more or less expensive than a generic conditioned SF.
  ["fitout_il", "Independent living unit fit-out", "SF", 28, 38, 52, "09 00 00", "C3000"],
  ["fitout_al", "Assisted living suite fit-out", "SF", 34, 46, 62, "09 00 00", "C3000"],
  ["fitout_mc", "Memory care room fit-out", "SF", 36, 48, 66, "09 00 00", "C3000"],
  ["fitout_snf", "Skilled nursing room fit-out", "SF", 46, 62, 84, "09 00 00", "C3000"],
  ["fitout_apt", "Apartment fit-out", "SF", 24, 33, 45, "09 00 00", "C3000"],
  ["fitout_apt_premium", "Premium apartment fit-out", "SF", 42, 58, 80, "09 00 00", "C3000"],
  ["fitout_dorm", "Residence hall room fit-out", "SF", 26, 35, 48, "09 00 00", "C3000"],
  ["fitout_hotel", "Guest room fit-out", "SF", 38, 52, 70, "09 00 00", "C3000"],
  ["fitout_hotel_suite", "Extended-stay suite fit-out", "SF", 44, 60, 80, "09 00 00", "C3000"],
  ["fitout_hotel_premium", "Premium suite fit-out", "SF", 58, 78, 105, "09 00 00", "C3000"],
  ["fitout_exam", "Exam room fit-out", "SF", 70, 95, 128, "09 00 00", "C3000"],
  ["fitout_clinic", "Clinical support fit-out", "SF", 58, 78, 105, "09 00 00", "C3000"],
  ["fitout_procedure", "Procedure / treatment room fit-out", "SF", 105, 142, 190, "09 00 00", "C3000"],
  ["fitout_or", "Operating room fit-out", "SF", 200, 270, 360, "09 00 00", "C3000"],
  ["fitout_patient", "Inpatient room fit-out", "SF", 120, 162, 218, "09 00 00", "C3000"],
  ["fitout_icu", "ICU room fit-out", "SF", 165, 222, 300, "09 00 00", "C3000"],
  ["fitout_behavioral", "Behavioral health room fit-out (ligature-resistant)", "SF", 95, 128, 172, "09 00 00", "C3000"],
  ["fitout_imaging", "Imaging suite fit-out (excl. equipment)", "SF", 150, 205, 275, "09 00 00", "C3000"],
  ["fitout_lab", "Wet lab fit-out", "SF", 130, 175, 235, "09 00 00", "C3000"],
  ["fitout_lab_dry", "Dry lab / maker fit-out", "SF", 72, 98, 132, "09 00 00", "C3000"],
  ["fitout_classroom", "Classroom fit-out", "SF", 34, 46, 62, "09 00 00", "C3000"],
  ["fitout_office", "Office fit-out", "SF", 30, 42, 58, "09 00 00", "C3000"],
  ["fitout_assembly", "Assembly space fit-out", "SF", 58, 78, 105, "09 00 00", "C3000"],
  ["fitout_dining", "Dining room fit-out", "SF", 52, 70, 95, "09 00 00", "C3000"],
  ["fitout_kitchen", "Commercial kitchen fit-out (excl. FF&E)", "SF", 120, 162, 218, "09 00 00", "C3000"],
  ["fitout_wellness", "Wellness / fitness fit-out", "SF", 46, 62, 84, "09 00 00", "C3000"],
  ["fitout_amenity", "General amenity fit-out", "SF", 38, 52, 70, "09 00 00", "C3000"],
  ["fitout_lobby", "Lobby fit-out", "SF", 62, 84, 114, "09 00 00", "C3000"],
  ["fitout_locker", "Locker room fit-out", "SF", 78, 105, 142, "09 00 00", "C3000"],
  ["fitout_gym", "Gymnasium fit-out", "SF", 42, 58, 78, "09 00 00", "C3000"],
  ["fitout_pool", "Natatorium fit-out", "SF", 165, 222, 300, "09 00 00", "C3000"],
  ["fitout_warehouse", "Warehouse / high-bay fit-out", "SF", 6, 9, 14, "09 00 00", "C3000"],
  ["fitout_freezer", "Freezer envelope & refrigeration", "SF", 105, 142, 190, "13 21 00", "C3000"],
  ["fitout_cooler", "Cooler envelope & refrigeration", "SF", 72, 98, 132, "13 21 00", "C3000"],
];

const BASIS =
  "Seed planning range from published industry cost guidance. Not DESTINI data — connect a DESTINI source to supersede.";

export const SEED_UNIT_COSTS: UnitCostLine[] = ROWS.map(
  ([key, label, uom, low, likely, high, csi, uniformat]) => ({
    id: `seed:rate:${key}`,
    key,
    label,
    uom,
    low,
    likely,
    high,
    csi,
    uniformat,
    indexBasis: SEED_INDEX_BASIS,
    pricedAt: SEED_PRICED_AT,
    provenance: {
      sourceId: "seed",
      sourceLabel: "BUD seed library",
      sourceKind: "seed" as const,
      asOf: SEED_PRICED_AT,
      basis: BASIS,
      confidence: "low" as const,
    },
  }),
);

export const SEED_RATE_KEYS: string[] = SEED_UNIT_COSTS.map((r) => r.key);
