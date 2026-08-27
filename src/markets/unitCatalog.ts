/**
 * Unit catalog — the space types a program is assembled from.
 *
 * Every building type's `unitRefs` and `programMix` point here by `ref`. A unit
 * carries its planning area (or fixed dimensions where the room is a standard
 * size), its occupancy, and the cost key its fit-out prices against.
 */

import type { Uom } from "@/costs/schema";

/** Broad grouping used for coloring, rollups, and efficiency accounting. */
export type UnitCategory =
  | "Independent Living"
  | "Assisted Living"
  | "Memory Care"
  | "Skilled Nursing"
  | "Behavioral"
  | "Clinical"
  | "Inpatient"
  | "Residential"
  | "Student Housing"
  | "Hospitality"
  | "Education"
  | "Office"
  | "Industrial"
  | "Assembly"
  | "Athletics"
  | "Amenity/Support"
  | "Parking";

/** Categories that count toward a project's headline capacity. */
export const COUNTABLE_CATEGORIES: ReadonlySet<UnitCategory> = new Set<UnitCategory>([
  "Independent Living",
  "Assisted Living",
  "Memory Care",
  "Skilled Nursing",
  "Behavioral",
  "Inpatient",
  "Residential",
  "Student Housing",
  "Hospitality",
]);

/** Categories that get a generated dwelling-style interior plan. */
export const DWELLING_CATEGORIES: ReadonlySet<UnitCategory> = new Set<UnitCategory>([
  "Independent Living",
  "Assisted Living",
  "Memory Care",
  "Skilled Nursing",
  "Residential",
  "Student Housing",
  "Hospitality",
]);

export interface UnitDef {
  ref: string;
  label: string;
  category: UnitCategory;
  /** "area" sizes to a target SF; "fixed" is a standard room dimension. */
  mode: "area" | "fixed";
  /** Planning area, SF. For fixed rooms this equals w * d. */
  area: number;
  /** Nominal frontage and depth, feet. Used for layout and plan generation. */
  w?: number;
  d?: number;
  /** Occupancy — beds or seats the unit provides. */
  beds?: number;
  /** Cost key this unit's fit-out prices against in the unit-cost catalog. */
  costKey: string;
  /** How this unit is counted when it appears as headline capacity. */
  capacityUom?: Uom;
  /** Full-depth units span the floor plate rather than one side of a corridor. */
  fullDepth?: boolean;
  notes?: string;
}

export const UNIT_CATALOG: UnitDef[] = [
  // --- Senior living dwelling ---
  { ref: "il_studio", label: "IL Studio", category: "Independent Living", mode: "area", area: 500, w: 18, d: 28, beds: 1, costKey: "fitout_il", capacityUom: "UNIT" },
  { ref: "il_1br", label: "IL 1-Bedroom", category: "Independent Living", mode: "area", area: 750, w: 26, d: 30, beds: 1, costKey: "fitout_il", capacityUom: "UNIT" },
  { ref: "il_1br_den", label: "IL 1BR + Den", category: "Independent Living", mode: "area", area: 950, w: 32, d: 30, beds: 1, costKey: "fitout_il", capacityUom: "UNIT" },
  { ref: "il_2br", label: "IL 2-Bedroom", category: "Independent Living", mode: "area", area: 1200, w: 40, d: 30, beds: 2, costKey: "fitout_il", capacityUom: "UNIT" },
  { ref: "il_2br_den", label: "IL 2BR + Den", category: "Independent Living", mode: "area", area: 1450, w: 48, d: 30, beds: 2, costKey: "fitout_il", capacityUom: "UNIT" },
  { ref: "il_cottage", label: "IL Cottage / Villa", category: "Independent Living", mode: "area", area: 1600, w: 40, d: 40, beds: 2, costKey: "fitout_il", capacityUom: "UNIT", fullDepth: true },
  { ref: "al_studio", label: "AL Studio", category: "Assisted Living", mode: "area", area: 400, w: 15, d: 28, beds: 1, costKey: "fitout_al", capacityUom: "UNIT" },
  { ref: "al_1br", label: "AL 1-Bedroom", category: "Assisted Living", mode: "area", area: 560, w: 20, d: 28, beds: 1, costKey: "fitout_al", capacityUom: "UNIT" },
  { ref: "al_companion", label: "AL Companion Suite", category: "Assisted Living", mode: "area", area: 640, w: 22, d: 30, beds: 2, costKey: "fitout_al", capacityUom: "UNIT" },
  { ref: "mc_private", label: "MC Private Room", category: "Memory Care", mode: "area", area: 340, w: 13, d: 28, beds: 1, costKey: "fitout_mc", capacityUom: "UNIT" },
  { ref: "mc_companion", label: "MC Companion Room", category: "Memory Care", mode: "area", area: 440, w: 16, d: 28, beds: 2, costKey: "fitout_mc", capacityUom: "UNIT" },
  { ref: "snf_private", label: "SNF Private Room", category: "Skilled Nursing", mode: "area", area: 300, w: 13, d: 26, beds: 1, costKey: "fitout_snf", capacityUom: "BED" },
  { ref: "snf_semi", label: "SNF Semi-Private Room", category: "Skilled Nursing", mode: "area", area: 380, w: 15, d: 28, beds: 2, costKey: "fitout_snf", capacityUom: "BED" },

  // --- Healthcare ---
  { ref: "exam_op", label: "Exam Room", category: "Clinical", mode: "fixed", area: 120, w: 10, d: 12, beds: 0, costKey: "fitout_exam" },
  { ref: "clin_proc", label: "Procedure Room", category: "Clinical", mode: "fixed", area: 255, w: 15, d: 17, beds: 0, costKey: "fitout_procedure" },
  { ref: "or_general", label: "OR (general)", category: "Clinical", mode: "fixed", area: 440, w: 20, d: 22, beds: 0, costKey: "fitout_or", capacityUom: "EA" },
  { ref: "or_specialty", label: "OR (specialty / hybrid)", category: "Clinical", mode: "fixed", area: 650, w: 25, d: 26, beds: 0, costKey: "fitout_or", capacityUom: "EA" },
  { ref: "clin_prepop", label: "Pre-Op / PACU Bay", category: "Clinical", mode: "fixed", area: 120, w: 10, d: 12, beds: 1, costKey: "fitout_procedure" },
  { ref: "clin_sterile", label: "Sterile Processing", category: "Clinical", mode: "area", area: 900, beds: 0, costKey: "fitout_procedure" },
  { ref: "clin_trauma", label: "Trauma Room", category: "Clinical", mode: "fixed", area: 350, w: 17, d: 21, beds: 1, costKey: "fitout_or" },
  { ref: "ed_bay", label: "ED Treatment Bay", category: "Clinical", mode: "fixed", area: 180, w: 12, d: 15, beds: 1, costKey: "fitout_procedure", capacityUom: "EA" },
  { ref: "bed_medsurg", label: "Med-Surg Patient Room", category: "Inpatient", mode: "fixed", area: 300, w: 15, d: 20, beds: 1, costKey: "fitout_patient", capacityUom: "BED" },
  { ref: "bed_icu", label: "ICU / CCU Room", category: "Inpatient", mode: "fixed", area: 320, w: 16, d: 20, beds: 1, costKey: "fitout_icu", capacityUom: "BED" },
  { ref: "clin_ldr", label: "LDR / LDRP Room", category: "Inpatient", mode: "fixed", area: 350, w: 16, d: 22, beds: 1, costKey: "fitout_patient", capacityUom: "BED" },
  { ref: "bh_room", label: "Behavioral Health Room", category: "Behavioral", mode: "fixed", area: 220, w: 11, d: 20, beds: 1, costKey: "fitout_behavioral", capacityUom: "BED" },
  { ref: "clin_imaging_ct", label: "CT Suite", category: "Clinical", mode: "fixed", area: 505, w: 22, d: 23, beds: 0, costKey: "fitout_imaging", capacityUom: "EA" },
  { ref: "clin_imaging_mri", label: "MRI Suite", category: "Clinical", mode: "fixed", area: 700, w: 25, d: 28, beds: 0, costKey: "fitout_imaging", capacityUom: "EA" },
  { ref: "clin_lab", label: "Clinical Laboratory", category: "Clinical", mode: "area", area: 1500, beds: 0, costKey: "fitout_lab" },
  { ref: "clin_pt", label: "PT / Rehab Gym", category: "Clinical", mode: "area", area: 1200, beds: 0, costKey: "fitout_clinic" },
  { ref: "sup_nurse", label: "Nurse Station / Support Core", category: "Amenity/Support", mode: "area", area: 700, beds: 0, costKey: "fitout_clinic" },

  // --- Higher education ---
  { ref: "dorm_double", label: "Dorm Double", category: "Student Housing", mode: "fixed", area: 180, w: 12, d: 15, beds: 2, costKey: "fitout_dorm", capacityUom: "BED" },
  { ref: "dorm_single", label: "Dorm Single", category: "Student Housing", mode: "fixed", area: 120, w: 10, d: 12, beds: 1, costKey: "fitout_dorm", capacityUom: "BED" },
  { ref: "dorm_suite", label: "Suite-Style Bedroom", category: "Student Housing", mode: "fixed", area: 144, w: 12, d: 12, beds: 2, costKey: "fitout_dorm", capacityUom: "BED" },
  { ref: "dorm_apt", label: "Apartment-Style (4-bed)", category: "Student Housing", mode: "area", area: 900, w: 30, d: 30, beds: 4, costKey: "fitout_apt", capacityUom: "BED", fullDepth: true },
  { ref: "edu_classroom", label: "Classroom (30-50 seat)", category: "Education", mode: "area", area: 900, beds: 0, costKey: "fitout_classroom" },
  { ref: "edu_lecture", label: "Lecture Hall", category: "Education", mode: "area", area: 2400, beds: 0, costKey: "fitout_assembly", fullDepth: true },
  { ref: "edu_seminar", label: "Seminar / Conference", category: "Education", mode: "area", area: 400, beds: 0, costKey: "fitout_classroom" },
  { ref: "edu_lab_wet", label: "Teaching Lab - Wet", category: "Education", mode: "area", area: 1600, beds: 0, costKey: "fitout_lab" },
  { ref: "edu_lab_dry", label: "Teaching Lab - Dry", category: "Education", mode: "area", area: 1200, beds: 0, costKey: "fitout_lab_dry" },
  { ref: "edu_maker", label: "Maker Space", category: "Education", mode: "area", area: 2000, beds: 0, costKey: "fitout_lab_dry", fullDepth: true },
  { ref: "off_faculty", label: "Faculty Office", category: "Office", mode: "fixed", area: 120, w: 10, d: 12, beds: 0, costKey: "fitout_office" },

  // --- Multifamily ---
  { ref: "apt_studio", label: "Studio Apartment", category: "Residential", mode: "area", area: 460, w: 16, d: 28, beds: 1, costKey: "fitout_apt", capacityUom: "UNIT" },
  { ref: "apt_1br", label: "1-Bedroom Apartment", category: "Residential", mode: "area", area: 735, w: 26, d: 28, beds: 1, costKey: "fitout_apt", capacityUom: "UNIT" },
  { ref: "apt_1br_den", label: "1BR + Den Apartment", category: "Residential", mode: "area", area: 850, w: 30, d: 28, beds: 1, costKey: "fitout_apt", capacityUom: "UNIT" },
  { ref: "apt_2br", label: "2-Bedroom Apartment", category: "Residential", mode: "area", area: 1100, w: 38, d: 29, beds: 2, costKey: "fitout_apt", capacityUom: "UNIT" },
  { ref: "apt_3br", label: "3-Bedroom Apartment", category: "Residential", mode: "area", area: 1340, w: 46, d: 29, beds: 3, costKey: "fitout_apt", capacityUom: "UNIT" },
  { ref: "apt_penthouse", label: "Penthouse", category: "Residential", mode: "area", area: 1800, w: 56, d: 32, beds: 3, costKey: "fitout_apt_premium", capacityUom: "UNIT" },
  { ref: "apt_townhome", label: "Townhome", category: "Residential", mode: "area", area: 1500, w: 22, d: 34, beds: 3, costKey: "fitout_apt", capacityUom: "UNIT", fullDepth: true },

  // --- Hospitality ---
  { ref: "hotel_king", label: "Standard King Key", category: "Hospitality", mode: "fixed", area: 338, w: 13, d: 26, beds: 1, costKey: "fitout_hotel", capacityUom: "KEY" },
  { ref: "hotel_double", label: "Double Queen Key", category: "Hospitality", mode: "fixed", area: 364, w: 14, d: 26, beds: 1, costKey: "fitout_hotel", capacityUom: "KEY" },
  { ref: "hotel_suite", label: "Hotel Suite", category: "Hospitality", mode: "fixed", area: 560, w: 20, d: 28, beds: 1, costKey: "fitout_hotel_premium", capacityUom: "KEY" },
  { ref: "hotel_studio_suite", label: "Studio Suite (extended stay)", category: "Hospitality", mode: "fixed", area: 390, w: 14, d: 28, beds: 1, costKey: "fitout_hotel_suite", capacityUom: "KEY" },
  { ref: "hotel_1br_suite", label: "1BR Suite (extended stay)", category: "Hospitality", mode: "fixed", area: 560, w: 20, d: 28, beds: 1, costKey: "fitout_hotel_suite", capacityUom: "KEY" },

  // --- Office / workplace ---
  { ref: "off_open", label: "Open Office", category: "Office", mode: "area", area: 2500, beds: 0, costKey: "fitout_office", fullDepth: true },
  { ref: "off_private", label: "Private Office", category: "Office", mode: "fixed", area: 150, w: 10, d: 15, beds: 0, costKey: "fitout_office" },

  // --- Industrial ---
  { ref: "ind_highbay", label: "High-Bay Floor", category: "Industrial", mode: "area", area: 25000, beds: 0, costKey: "fitout_warehouse", fullDepth: true },
  { ref: "ind_dock", label: "Dock / Staging", category: "Industrial", mode: "area", area: 3000, beds: 0, costKey: "fitout_warehouse", fullDepth: true },
  { ref: "ind_freezer", label: "Freezer (-10F)", category: "Industrial", mode: "area", area: 20000, beds: 0, costKey: "fitout_freezer", fullDepth: true },
  { ref: "ind_cooler", label: "Cooler (35F)", category: "Industrial", mode: "area", area: 20000, beds: 0, costKey: "fitout_cooler", fullDepth: true },

  // --- Assembly / athletics / civic ---
  { ref: "ath_court", label: "Gymnasium / Court", category: "Athletics", mode: "area", area: 10000, beds: 0, costKey: "fitout_gym", fullDepth: true },
  { ref: "ath_pool", label: "Natatorium", category: "Athletics", mode: "area", area: 9000, beds: 0, costKey: "fitout_pool", fullDepth: true },
  { ref: "civ_sanctuary", label: "Sanctuary", category: "Assembly", mode: "area", area: 6000, beds: 0, costKey: "fitout_assembly", fullDepth: true },
  { ref: "civ_apparatus", label: "Apparatus Bay", category: "Assembly", mode: "area", area: 4000, beds: 0, costKey: "fitout_warehouse", fullDepth: true },

  // --- Amenity / support ---
  { ref: "amen_dining", label: "Dining Room", category: "Amenity/Support", mode: "area", area: 2500, beds: 0, costKey: "fitout_dining", fullDepth: true },
  { ref: "amen_kitchen", label: "Commercial Kitchen", category: "Amenity/Support", mode: "area", area: 1800, beds: 0, costKey: "fitout_kitchen", fullDepth: true },
  { ref: "amen_bistro", label: "Bistro / Cafe", category: "Amenity/Support", mode: "area", area: 900, beds: 0, costKey: "fitout_dining" },
  { ref: "amen_wellness", label: "Wellness Center", category: "Amenity/Support", mode: "area", area: 3500, beds: 0, costKey: "fitout_wellness", fullDepth: true },
  { ref: "amen_fitness", label: "Fitness Center", category: "Amenity/Support", mode: "area", area: 1500, beds: 0, costKey: "fitout_wellness" },
  { ref: "amen_salon", label: "Salon / Barber", category: "Amenity/Support", mode: "area", area: 400, beds: 0, costKey: "fitout_amenity" },
  { ref: "amen_theater", label: "Theater / Multipurpose", category: "Amenity/Support", mode: "area", area: 1500, beds: 0, costKey: "fitout_assembly", fullDepth: true },
  { ref: "amen_activity", label: "Activity / Community Room", category: "Amenity/Support", mode: "area", area: 1200, beds: 0, costKey: "fitout_amenity" },
  { ref: "amen_community", label: "Community Room", category: "Amenity/Support", mode: "area", area: 800, beds: 0, costKey: "fitout_amenity" },
  { ref: "amen_lobby", label: "Lobby / Reception", category: "Amenity/Support", mode: "area", area: 900, beds: 0, costKey: "fitout_lobby", fullDepth: true },
  { ref: "amen_study", label: "Study / Learning Commons", category: "Amenity/Support", mode: "area", area: 1000, beds: 0, costKey: "fitout_amenity" },
  { ref: "amen_locker", label: "Locker Room", category: "Amenity/Support", mode: "area", area: 1400, beds: 0, costKey: "fitout_locker" },
  { ref: "amen_ballroom", label: "Ballroom / Banquet", category: "Amenity/Support", mode: "area", area: 6000, beds: 0, costKey: "fitout_assembly", fullDepth: true },

  // --- Parking ---
  {
    ref: "pk_stall", label: "Parking Stall", category: "Parking",
    // Area mode, not fixed: a stall's planning area is the stripe PLUS its
    // share of drive aisle and ramp. w/d stay the stall stripe for drawing.
    mode: "area", area: 340, w: 9, d: 18, beds: 0,
    costKey: "parking_stall", capacityUom: "STALL",
    notes: "340 SF/stall includes the drive aisle and ramp share; the 9x18 dimension is the stripe itself.",
  },
];

export const UNIT_BY_REF: Record<string, UnitDef> = Object.fromEntries(
  UNIT_CATALOG.map((u) => [u.ref, u]),
);

/** Effective planning area of a unit, SF. */
export const unitArea = (u: UnitDef): number => (u.mode === "fixed" ? (u.w ?? 10) * (u.d ?? 10) : u.area);
