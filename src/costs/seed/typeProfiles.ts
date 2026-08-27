/**
 * Cost profiles by building type.
 *
 * A generic $/GSF rate for HVAC is right for an apartment and badly wrong for
 * an operating room or a freezer. Rather than a rate table with 42 columns,
 * each building type names a profile, and a profile is a sparse set of
 * multipliers against the base rate catalog.
 *
 * Multipliers are applied by the seed source when a query names a building
 * type, producing a genuine type-specific `UnitCostLine` that flows through
 * the resolver like any other — and that a DESTINI feed can supersede per type.
 *
 * Anything not listed multiplies by 1.
 */

export type RateMultipliers = Record<string, number>;

export interface CostProfile {
  id: string;
  label: string;
  /** Why this type prices differently — shown in the provenance note. */
  rationale: string;
  multipliers: RateMultipliers;
  /**
   * $/GSF allowances this type carries, merged over `BASE_ALLOWANCES`. These
   * are the scope a conceptual benchmark includes but a geometric takeoff
   * cannot see: FF&E, low voltage, specialties, equipment, demolition. Set a
   * key to 0 to drop an allowance the baseline carries.
   */
  allowances?: Record<string, number>;
}

/** Allowances every building type carries unless its profile says otherwise. */
export const BASE_ALLOWANCES: Record<string, number> = {
  allow_ffe: 7,
  allow_lowvoltage: 5.5,
  allow_specialties: 2.5,
  allow_signage: 1,
  allow_millwork: 2,
  allow_equipment: 0,
  allow_medgas: 0,
  allow_demo: 0,
};

/** Resolved $/GSF allowances for a profile. */
export const allowancesFor = (profile: CostProfile): Record<string, number> => ({
  ...BASE_ALLOWANCES,
  ...(profile.allowances ?? {}),
});

export const COST_PROFILES: Record<string, CostProfile> = {
  wood_residential: {
    id: "wood_residential",
    label: "Wood-framed residential",
    rationale: "Baseline: light wood frame, residential loads and finishes.",
    multipliers: {},
  },

  wood_residential_walkup: {
    id: "wood_residential_walkup",
    label: "Wood-framed walk-up",
    rationale: "Two to three stories, no elevator, surface parking, simplest residential systems.",
    multipliers: {
      hvac: 0.82, electrical: 0.88, sprinkler: 0.88, ceiling: 0.8, flooring: 0.88,
      int_framing: 0.9, elevated_floor: 0.85, roof: 0.72, roof_struct: 0.85,
      elevator_base: 0, elevator_stop: 0, partition: 0.92,
    },
    allowances: { allow_ffe: 3, allow_lowvoltage: 3, allow_specialties: 1.5, allow_millwork: 1 },
  },

  podium_residential: {
    id: "podium_residential",
    label: "Podium residential",
    rationale: "Wood over a concrete podium: transfer slab and taller lower level.",
    multipliers: { elevated_floor: 1.45, roof_struct: 1.1, spread_found: 1.25, electrical: 1.08 },
    allowances: { allow_ffe: 8, allow_lowvoltage: 6.5 },
  },

  concrete_residential: {
    id: "concrete_residential",
    label: "Concrete residential",
    rationale: "Cast-in-place frame, institutional durability, longer corridors.",
    multipliers: { elevated_floor: 1.7, roof_struct: 1.15, spread_found: 1.3, partition: 1.12, door: 1.1 },
    allowances: { allow_ffe: 9, allow_lowvoltage: 7, allow_millwork: 2.5 },
  },

  concrete_highrise: {
    id: "concrete_highrise",
    label: "Concrete high-rise",
    rationale: "Tower frame, high-rise MEP and life safety, curtain wall, pressurized stairs.",
    multipliers: {
      elevated_floor: 1.95,
      roof_struct: 1.2,
      spread_found: 1.6,
      hvac: 1.3,
      electrical: 1.28,
      sprinkler: 1.2,
      partition: 1.12,
      stair_flight: 1.35,
      elevator_base: 1.5,
      elevator_stop: 1.3,
    },
    allowances: { allow_ffe: 11, allow_lowvoltage: 8.5, allow_specialties: 4, allow_millwork: 3 },
  },

  light_gauge_hospitality: {
    id: "light_gauge_hospitality",
    label: "Light-gauge hospitality",
    rationale: "Load-bearing metal stud, brand-standard finishes, PTAC-per-key.",
    multipliers: { elevated_floor: 1.2, hvac: 1.15, electrical: 1.12, flooring: 1.1 },
    allowances: { allow_ffe: 16, allow_lowvoltage: 8, allow_millwork: 4, allow_specialties: 3 },
  },

  concrete_hospitality: {
    id: "concrete_hospitality",
    label: "Concrete hospitality",
    rationale: "Concrete frame with banquet and kitchen loads under the guest tower.",
    multipliers: {
      elevated_floor: 1.8, roof_struct: 1.15, hvac: 1.45, electrical: 1.35,
      sprinkler: 1.15, flooring: 1.2, ceiling: 1.2, elevator_base: 1.4,
    },
    allowances: { allow_ffe: 24, allow_lowvoltage: 11, allow_millwork: 6, allow_specialties: 4.5, allow_equipment: 8 },
  },

  senior_independent: {
    id: "senior_independent",
    label: "Independent living",
    rationale: "Residential systems with commercial corridors, generator, and amenity loads.",
    multipliers: { hvac: 1.12, electrical: 1.12, sprinkler: 1.05, door: 1.08, flooring: 1.08 },
    allowances: { allow_ffe: 12, allow_lowvoltage: 8, allow_millwork: 4, allow_specialties: 3.5, allow_equipment: 4 },
  },

  senior_licensed: {
    id: "senior_licensed",
    label: "Licensed senior care",
    rationale: "Licensed occupancy: nurse call, emergency power, rated construction, wider doors.",
    multipliers: {
      hvac: 1.3, electrical: 1.28, sprinkler: 1.1, partition: 1.14,
      door: 1.2, flooring: 1.15, ceiling: 1.1,
    },
    allowances: { allow_ffe: 14, allow_lowvoltage: 10, allow_millwork: 4.5, allow_specialties: 4, allow_equipment: 6 },
  },

  skilled_nursing: {
    id: "skilled_nursing",
    label: "Skilled nursing",
    rationale: "Institutional healthcare: medical gas rough-in, higher air changes, heavy-duty finishes.",
    multipliers: {
      hvac: 1.55, electrical: 1.45, sprinkler: 1.15, partition: 1.22,
      door: 1.25, flooring: 1.28, ceiling: 1.15, elevated_floor: 1.2,
    },
    allowances: { allow_ffe: 15, allow_lowvoltage: 12, allow_millwork: 4.5, allow_specialties: 5, allow_equipment: 10, allow_medgas: 6 },
  },

  healthcare_outpatient: {
    id: "healthcare_outpatient",
    label: "Outpatient healthcare",
    rationale: "Clinic air changes, isolation zoning, imaging power, washable assemblies.",
    multipliers: {
      hvac: 1.8, electrical: 1.5, sprinkler: 1.1, partition: 1.18,
      ceiling: 1.2, flooring: 1.3, door: 1.15,
    },
    allowances: { allow_ffe: 12, allow_lowvoltage: 14, allow_specialties: 5, allow_millwork: 4, allow_equipment: 14, allow_medgas: 5 },
  },

  healthcare_mob: {
    id: "healthcare_mob",
    label: "Medical office building",
    rationale: "An office shell with clinical tenant work; the fit-out carries the clinical premium.",
    multipliers: {
      hvac: 1.3, electrical: 1.2, sprinkler: 1.05, partition: 1.08,
      ceiling: 1.05, flooring: 1.1, elevated_floor: 1.4, roof_struct: 1.2,
      spread_found: 1.3, elevator_base: 1.2,
    },
    allowances: { allow_ffe: 6, allow_lowvoltage: 8, allow_specialties: 3, allow_millwork: 2.5, allow_equipment: 5, allow_medgas: 2 },
  },

  healthcare_inpatient: {
    id: "healthcare_inpatient",
    label: "Inpatient behavioral",
    rationale: "Ligature-resistant fixtures and hardware throughout; secured, tamper-proof detailing.",
    multipliers: {
      hvac: 1.7, electrical: 1.5, sprinkler: 1.2, partition: 1.4,
      door: 1.9, flooring: 1.35, ceiling: 1.5, plumb_fixture: 1.8,
    },
    allowances: { allow_ffe: 14, allow_lowvoltage: 16, allow_specialties: 7, allow_millwork: 3, allow_equipment: 10, allow_medgas: 4 },
  },

  healthcare_acute: {
    id: "healthcare_acute",
    label: "Acute care",
    rationale: "Full redundancy, medical gas, 100% outside air zones, lead shielding, vibration limits.",
    multipliers: {
      hvac: 2.6, electrical: 2.1, sprinkler: 1.25, partition: 1.3,
      ceiling: 1.35, flooring: 1.4, door: 1.35, elevated_floor: 1.6,
      spread_found: 1.3, plumb_fixture: 1.5, elevator_base: 1.6,
    },
    allowances: { allow_ffe: 18, allow_lowvoltage: 22, allow_specialties: 8, allow_millwork: 5, allow_equipment: 34, allow_medgas: 14 },
  },

  academic: {
    id: "academic",
    label: "Academic",
    rationale: "Institutional loads, higher floor-to-floor, durable public finishes.",
    multipliers: {
      hvac: 1.6, electrical: 1.45, elevated_floor: 1.5, roof_struct: 1.25,
      spread_found: 1.25, flooring: 1.25, ceiling: 1.25, partition: 1.2, door: 1.15,
      stair_flight: 1.2, elevator_base: 1.2,
    },
    allowances: { allow_ffe: 15, allow_lowvoltage: 12, allow_specialties: 6, allow_millwork: 6, allow_equipment: 10 },
  },

  lab: {
    id: "lab",
    label: "Teaching / research lab",
    rationale: "Fume hood exhaust, lab gases, vibration criteria, 100% outside air.",
    multipliers: {
      hvac: 2.9, electrical: 2.1, elevated_floor: 1.6, sprinkler: 1.15,
      spread_found: 1.35, flooring: 1.3, ceiling: 1.3, partition: 1.35,
      plumb_fixture: 1.4, door: 1.2,
    },
    allowances: { allow_ffe: 16, allow_lowvoltage: 14, allow_specialties: 6, allow_millwork: 10, allow_equipment: 38 },
  },

  assembly_longspan: {
    id: "assembly_longspan",
    label: "Long-span assembly",
    rationale: "Clear-span roof structure over gyms, pools, and halls; high-volume conditioning.",
    multipliers: {
      roof_struct: 2.2, elevated_floor: 1.3, hvac: 1.35, electrical: 1.2,
      spread_found: 1.15, ceiling: 1.3,
    },
    allowances: { allow_ffe: 10, allow_lowvoltage: 9, allow_specialties: 6, allow_millwork: 2, allow_equipment: 12 },
  },

  flex: {
    id: "flex",
    label: "Flex / R&D",
    rationale: "High-bay shell with an office front: services split between the two.",
    multipliers: {
      hvac: 0.65, electrical: 0.85, int_framing: 0.45, paint: 0.5, ceiling: 0.4,
      flooring: 0.45, base_trim: 0.4, roof_struct: 1.15, partition: 0.6,
    },
    allowances: { allow_ffe: 4, allow_lowvoltage: 3.5, allow_specialties: 1.5, allow_millwork: 1 },
  },

  manufacturing: {
    id: "manufacturing",
    label: "Light manufacturing",
    rationale: "Process power and compressed air over a bare production floor.",
    multipliers: {
      hvac: 0.5, electrical: 1.15, int_framing: 0.2, paint: 0.25, ceiling: 0.1,
      flooring: 0.3, base_trim: 0.1, sprinkler: 1.2, roof_struct: 0.95, roof: 0.7,
      partition: 0.3, slab_grade: 1.5, spread_found: 0.85,
    },
    allowances: { allow_ffe: 2, allow_lowvoltage: 3, allow_specialties: 1.5, allow_millwork: 0.5, allow_equipment: 6 },
  },

  warehouse: {
    id: "warehouse",
    label: "Warehouse / distribution",
    rationale: "Bare shell: no ceilings, minimal finish, ESFR sprinkler, super-flat slab.",
    multipliers: {
      hvac: 0.14, electrical: 0.4, int_framing: 0.1, paint: 0.14, ceiling: 0.04,
      flooring: 0.1, base_trim: 0.04, sprinkler: 1.0,
      // A single-story box pays for its roof over its entire floor area, so
      // the roof rate drives $/GSF harder here than anywhere else. Warehouse
      // roofing is a thin TPO-on-deck assembly on bar joists, not a
      // high-performance roof over a framed deck.
      roof: 0.45, roof_struct: 0.65,
      elevated_floor: 0.9, partition: 0.15, door: 0.35,
      slab_grade: 1.2, spread_found: 0.5, fitout_warehouse: 0.4,
      // The tilt-up panel is the wall — there is no stud backup behind it.
      ext_framing: 0.12, air_barrier: 0.3,
    },
    allowances: { allow_ffe: 1, allow_lowvoltage: 2, allow_specialties: 1.5, allow_millwork: 0.3, allow_equipment: 2 },
  },

  cold_storage: {
    id: "cold_storage",
    label: "Cold storage",
    rationale: "Insulated panel envelope, refrigeration plant, under-slab heat, vapor barrier.",
    multipliers: {
      hvac: 0.55, electrical: 0.95, int_framing: 0.1, paint: 0.1, ceiling: 0.04,
      flooring: 0.4, base_trim: 0.04, sprinkler: 1.4, slab_grade: 1.9,
      roof_struct: 1.0, roof: 1.25, partition: 0.2, door: 0.4,
    },
    allowances: { allow_ffe: 1.5, allow_lowvoltage: 3, allow_specialties: 2, allow_millwork: 0.3, allow_equipment: 26 },
  },

  office_shell: {
    id: "office_shell",
    label: "Office core & shell",
    rationale: "Base building only: core finishes, primary distribution, no tenant work.",
    multipliers: {
      int_framing: 0.25, paint: 0.2, ceiling: 0.28, flooring: 0.2, base_trim: 0.18,
      // A base building still carries its central plant and main service.
      hvac: 1.15, electrical: 1.12, partition: 0.2, door: 0.28,
      elevated_floor: 1.7, roof_struct: 1.3, spread_found: 1.45,
      elevator_base: 1.45, elevator_stop: 1.2, stair_flight: 1.25,
    },
    allowances: { allow_ffe: 1, allow_lowvoltage: 3.5, allow_specialties: 2, allow_millwork: 1, allow_equipment: 4 },
  },

  office_fitout: {
    id: "office_fitout",
    label: "Office fit-out",
    rationale: "Tenant work inside an existing shell: no structure, envelope, or substructure.",
    multipliers: { hvac: 0.55, electrical: 0.7, sprinkler: 0.6 },
    allowances: { allow_ffe: 14, allow_lowvoltage: 9, allow_specialties: 2, allow_millwork: 5 },
  },

  civic_essential: {
    id: "civic_essential",
    label: "Essential facility",
    rationale: "Risk Category IV structure, full standby power, hardened envelope, secure zones.",
    multipliers: {
      hvac: 1.55, electrical: 1.85, elevated_floor: 1.6, roof_struct: 1.4,
      spread_found: 1.5, sprinkler: 1.15, partition: 1.25, door: 1.3,
      flooring: 1.2, ceiling: 1.2, stair_flight: 1.3,
    },
    allowances: { allow_ffe: 14, allow_lowvoltage: 18, allow_specialties: 8, allow_millwork: 5, allow_equipment: 12 },
  },

  parking_below: {
    id: "parking_below",
    label: "Below-grade parking",
    rationale: "Excavation, shoring, waterproofing, and a structural lid carrying the building above.",
    multipliers: {
      hvac: 0.35, electrical: 0.45, int_framing: 0.02, paint: 0.1, ceiling: 0,
      flooring: 0, base_trim: 0, sprinkler: 0.75, partition: 0.05, door: 0.08,
      elevated_floor: 2.1, roof_struct: 0, roof: 0,
      excavation: 1.6, found_wall: 1.5, waterproofing: 1.45, spread_found: 1.8,
    },
    allowances: { allow_ffe: 0, allow_lowvoltage: 2.5, allow_specialties: 2, allow_millwork: 0, allow_signage: 1.2 },
  },

  parking_structure: {
    id: "parking_structure",
    label: "Parking structure",
    rationale: "Open deck: no conditioned space, no finishes, drainage and lighting only.",
    multipliers: {
      hvac: 0.04, electrical: 0.3, int_framing: 0.02, paint: 0.08, ceiling: 0.0,
      flooring: 0.0, base_trim: 0.0, sprinkler: 0.35, partition: 0.05, door: 0.05,
      elevated_floor: 1.15,
    },
    allowances: { allow_ffe: 0, allow_lowvoltage: 1.5, allow_specialties: 1.5, allow_millwork: 0, allow_signage: 1.2 },
  },

  parking_surface: {
    id: "parking_surface",
    label: "Surface parking",
    rationale: "Sitework only: paving, striping, lighting, stormwater.",
    multipliers: {
      hvac: 0, electrical: 0.12, int_framing: 0, paint: 0, ceiling: 0, flooring: 0,
      base_trim: 0, sprinkler: 0, partition: 0, door: 0, elevated_floor: 0,
      roof_struct: 0, spread_found: 0.1, slab_grade: 0.15,
    },
    allowances: { allow_ffe: 0, allow_lowvoltage: 0.3, allow_specialties: 0.4, allow_millwork: 0, allow_signage: 0.5 },
  },
};

export const DEFAULT_PROFILE = COST_PROFILES.wood_residential;

export const profileFor = (id: string | undefined): CostProfile =>
  (id && COST_PROFILES[id]) || DEFAULT_PROFILE;
