/**
 * Quantity takeoff.
 *
 * Rolls every mass in a scheme into the quantity vector the estimate prices.
 * Quantities are keyed by rate key so pricing is a join against whatever the
 * cost resolver returns, with no per-division special-casing.
 */

import { UNIT_BY_REF, unitArea } from "@/markets/unitCatalog";
import { TYPE_BY_ID } from "@/markets/registry";
import { ALLOWANCE_KEYS } from "@/costs/seed/unitCosts";
import type { Uom } from "@/costs/schema";
import {
  belowGradeTakeoff,
  envelopeTakeoff,
  floorPlates,
  footprint,
  grossArea,
  massSegments,
  type Mass,
} from "./massing";
import { featuresTakeoff } from "./features";
import { footprintPerimeter } from "./footprint";
import { massFootprint } from "./massing";
import {
  circulation,
  netProgramArea,
  totalBeds,
  totalUnits,
  type CirculationSettings,
  DEFAULT_CIRCULATION,
} from "./program";

/** Per-unit fit-out allowances applied where no detailed plan exists. */
export interface TakeoffFactors {
  doorsPerUnit: number;
  fixturesPerUnit: number;
  applianceSetsPerUnit: number;
  /** Partition LF per SF of unit area. */
  partitionLFPerSF: number;
}

export const DEFAULT_FACTORS: TakeoffFactors = {
  doorsPerUnit: 3,
  fixturesPerUnit: 2,
  applianceSetsPerUnit: 1,
  partitionLFPerSF: 0.055,
};

/** Site improvement areas by kind, SF. */
export interface SiteQuantities {
  parking: number;
  patio: number;
  basin: number;
  lawn: number;
}

export const EMPTY_SITE: SiteQuantities = { parking: 0, patio: 0, basin: 0, lawn: 0 };

export interface Takeoff {
  /** rate key -> quantity, in that rate's own unit of measure. */
  quantities: Record<string, number>;
  /** Rollup figures the UI and conceptual comparison need. */
  gsf: number;
  footprintSF: number;
  netProgram: number;
  units: number;
  beds: number;
  stairs: number;
  elevators: number;
  coreSF: number;
  massCount: number;
  /**
   * Capacity tallied in each unit of measure the program actually provides —
   * apartments, keys, beds, stalls. A conceptual benchmark quoted per stall
   * needs a stall count, and only the program knows it.
   */
  capacity: Partial<Record<Uom, number>>;
  /** Fit-out SF by unit cost key, kept for the division breakdown. */
  fitoutBySF: Record<string, number>;
}

const add = (q: Record<string, number>, key: string, amount: number) => {
  if (!amount) return;
  q[key] = (q[key] ?? 0) + amount;
};

export function takeoff(
  masses: Mass[],
  opts: {
    circulation?: CirculationSettings;
    factors?: TakeoffFactors;
    site?: SiteQuantities;
  } = {},
): Takeoff {
  const cs = opts.circulation ?? DEFAULT_CIRCULATION;
  const factors = opts.factors ?? DEFAULT_FACTORS;
  const site = opts.site ?? EMPTY_SITE;

  const q: Record<string, number> = {};
  const fitoutBySF: Record<string, number> = {};
  const capacityByUom: Partial<Record<Uom, number>> = {};

  const countCapacity = (program: Record<string, number>) => {
    for (const [ref, n] of Object.entries(program)) {
      const unit = UNIT_BY_REF[ref];
      if (!unit?.capacityUom || !n) continue;
      capacityByUom[unit.capacityUom] = (capacityByUom[unit.capacityUom] ?? 0) + n;
    }
  };

  let gsf = 0;
  let footprintSF = 0;
  let netProgram = 0;
  let units = 0;
  let beds = 0;
  let stairs = 0;
  let elevators = 0;
  let coreSF = 0;

  // Context buildings are scenery, never scope.
  const scope = masses.filter((m) => !m.context);

  for (const m of scope) {
    // Scope mode decides which whole categories of work this mass carries at
    // all. A tenant fit-out has no foundations; a parking deck has no fit-out.
    const mode = TYPE_BY_ID[m.typeId]?.defaults.scopeMode ?? "full";
    const fp = footprint(m);

    // Site-only scope is not a building: it contributes paving, not structure.
    // Paved area follows the stall count the program asked for, falling back to
    // the drawn footprint when nothing is programmed.
    if (mode === "site") {
      countCapacity(m.program);
      const paved = Object.entries(m.program).reduce((a, [ref, n]) => {
        const unit = UNIT_BY_REF[ref];
        return unit ? a + (n || 0) * unitArea(unit) : a;
      }, 0);
      const area = paved > 0 ? paved : fp;
      add(q, "site_parking", area);
      footprintSF += area;
      continue;
    }

    const hasShell = mode !== "interiors";
    const hasInteriors = mode !== "structure";
    const hasFitout = mode === "full" || mode === "interiors";

    const area = grossArea(m);
    gsf += area;
    footprintSF += fp;
    netProgram += netProgramArea(m);
    units += totalUnits(m);
    beds += totalBeds(m);
    countCapacity(m.program);

    if (hasShell) {
      // --- Substructure ---
      const bg = belowGradeTakeoff(m);
      add(q, "spread_found", fp);
      add(q, "slab_grade", fp + bg.slabBelow);
      add(q, "excavation", bg.excavationCY);
      add(q, "found_wall", bg.buriedWall);
      add(q, "waterproofing", bg.buriedWall);

      // --- Structure ---
      // Sum the actual upper plates rather than multiplying the ground floor:
      // with a setback the upper floors are smaller, and that is the point of
      // drawing one.
      const plates = floorPlates(m);
      add(q, "elevated_floor", plates.slice(1).reduce((a, plate) => a + plate.area, 0));

      // --- Envelope ---
      const env = envelopeTakeoff(m);
      add(q, "roof_struct", env.roofFlat + env.roofPitched);
      add(q, "roof", env.roofFlat);
      add(q, "roof_pitched", env.roofPitched);
      add(q, "air_barrier", env.opaque);
      add(q, "ext_framing", env.opaque);
      for (const [skin, sf] of Object.entries(env.opaqueBySkin)) add(q, `wall_${skin}`, sf);
      for (const [kind, sf] of Object.entries(env.glassByType)) add(q, kind, sf ?? 0);
    }

    // --- Interiors and MEP, per gross SF ---
    if (hasInteriors) {
      for (const key of ["int_framing", "paint", "ceiling", "flooring", "base_trim", "sprinkler", "hvac", "electrical"]) {
        add(q, key, area);
      }
    }

    // --- Architectural features ---
    // A canopy in the render is a canopy in the estimate, from the same
    // parameters. The envelope adjustments were already applied inside
    // envelopeTakeoff; these are the features' own priced lines.
    if (hasShell) {
      const featureQuantities = featuresTakeoff(m.features ?? [], {
        segments: massSegments(m),
        floors: m.floors,
        floorToFloor: m.fth,
        roofPerimeter: footprintPerimeter(massFootprint(m)),
      }).quantities;
      for (const [key, value] of Object.entries(featureQuantities)) add(q, key, value);
    }

    // --- $/GSF allowances ---
    // Carried on every mass with real floor area; the rate a type resolves for
    // each key is what decides whether it amounts to anything.
    for (const key of ALLOWANCE_KEYS) add(q, key, area);

    // --- Unit fit-out ---
    for (const [ref, count] of Object.entries(hasFitout ? m.program : {})) {
      const unit = UNIT_BY_REF[ref];
      if (!unit || !count) continue;
      const sf = unitArea(unit) * count;
      add(q, unit.costKey, sf);
      fitoutBySF[unit.costKey] = (fitoutBySF[unit.costKey] ?? 0) + sf;

      // Partitions scale with area; doors, fixtures, and appliances with count.
      add(q, "partition", sf * factors.partitionLFPerSF);
      add(q, "door", count * factors.doorsPerUnit);

      const isDwelling = (unit.beds ?? 0) > 0;
      if (isDwelling) {
        add(q, "plumb_fixture", count * factors.fixturesPerUnit);
        // Only spaces with a real kitchen get an appliance set.
        if (unit.costKey.startsWith("fitout_apt") || unit.costKey === "fitout_il") {
          add(q, "appliance", count * factors.applianceSetsPerUnit);
        }
      }
    }

    // --- Circulation cores ---
    const circ = circulation(m, cs);
    stairs += circ.stairs;
    elevators += circ.elevators;
    coreSF += circ.coreSF;
    add(q, "stair_flight", circ.stairs * m.floors);
    if (circ.elevators > 0) {
      add(q, "elevator_base", circ.elevators);
      add(q, "elevator_stop", circ.elevators * Math.max(0, m.floors - 1));
    }
  }

  // --- Sitework ---
  add(q, "site_parking", site.parking);
  add(q, "site_patio", site.patio);
  add(q, "site_basin", site.basin);
  add(q, "site_lawn", site.lawn);

  return {
    quantities: q,
    gsf,
    footprintSF,
    netProgram,
    units,
    beds,
    stairs,
    elevators,
    coreSF,
    massCount: scope.length,
    capacity: capacityByUom,
    fitoutBySF,
  };
}
