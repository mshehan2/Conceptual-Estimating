/**
 * Project, scheme, and iteration.
 *
 * A project is pinned to a market. Within it, each scheme is one option —
 * usually a different building type, a different height, or a different mix —
 * and schemes are meant to be forked, renamed, and compared rather than edited
 * in place. That is what "iterate by market, then type" means here: the market
 * is the project's identity, the type is the variable.
 */

import type { RateOverride } from "@/costs/sources/overrideSource";
import type { BandPoint, IndirectSettings, MarketAdjustment } from "./estimate";
import { DEFAULT_ADJUSTMENT, DEFAULT_INDIRECTS } from "./estimate";
import { makeMassForType, type Mass } from "./massing";
import { DEFAULT_CIRCULATION, fitFootprint, seedProgramForType, type CirculationSettings } from "./program";
import { DEFAULT_FACTORS, EMPTY_SITE, type SiteQuantities, type TakeoffFactors } from "./takeoff";
import { MARKET_BY_ID, TYPE_BY_ID, typesForMarket } from "@/markets/registry";

export interface ProjectLocation {
  address: string;
  city: string;
  state?: string;
  lat?: number;
  lon?: number;
  /** Resolved location index, 100 = national baseline. */
  index: number;
  /** Distance to the indexed metro, miles — non-zero means it was inferred. */
  milesToIndexCity?: number;
}

export interface Scheme {
  id: string;
  name: string;
  /** Building type this scheme explores. Must belong to the project market. */
  typeId: string;
  /** Capacity target in the type's own unit. */
  targetCapacity: number;
  masses: Mass[];
  site: SiteQuantities;
  note: string;
  createdAt: string;
  updatedAt: string;
  /** Scheme this one was forked from, for the iteration trail. */
  forkedFrom?: string;
}

export interface ProjectSettings {
  indirects: IndirectSettings;
  adjustment: MarketAdjustment;
  circulation: CirculationSettings;
  factors: TakeoffFactors;
  band: BandPoint;
}

export interface DecisionLogEntry {
  id: string;
  at: string;
  text: string;
  schemeId?: string;
  /** Snapshot of the headline number when the note was made. */
  total?: number;
  gsf?: number;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  number: string;
  marketId: string;
  location: ProjectLocation;
  schemes: Scheme[];
  activeSchemeId: string;
  /** Scheme every comparison is measured against. */
  baselineSchemeId: string;
  settings: ProjectSettings;
  overrides: RateOverride[];
  decisionLog: DecisionLogEntry[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------

let seq = 1;
const nextId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;
const now = () => new Date().toISOString();

export const DEFAULT_SETTINGS: ProjectSettings = {
  indirects: { ...DEFAULT_INDIRECTS },
  adjustment: { ...DEFAULT_ADJUSTMENT },
  circulation: { ...DEFAULT_CIRCULATION },
  factors: { ...DEFAULT_FACTORS },
  band: "likely",
};

/**
 * Build a scheme for a building type at a capacity target.
 *
 * Seeds the program from the type's default mix, sizes a footprint that holds
 * it, and creates the mass with the type's massing defaults — so a new scheme
 * is immediately a plausible building rather than an empty box.
 */
export function makeScheme(
  typeId: string,
  opts: { name?: string; targetCapacity?: number; floors?: number; forkedFrom?: string } = {},
): Scheme {
  const type = TYPE_BY_ID[typeId];
  const target = opts.targetCapacity ?? defaultCapacityFor(typeId);
  const floors = opts.floors ?? type?.defaults.floors ?? 3;
  const seeded = seedProgramForType(typeId, target);
  const { w, d } = fitFootprint(seeded.netArea, typeId, floors);

  const mass = makeMassForType(typeId, { w, d, floors, program: seeded.program });
  const stamp = now();

  return {
    id: nextId("sc"),
    name: opts.name ?? type?.label ?? "Scheme",
    typeId,
    targetCapacity: target,
    masses: [mass],
    site: { ...EMPTY_SITE, parking: parkingArea(typeId, target) },
    note: "",
    createdAt: stamp,
    updatedAt: stamp,
    forkedFrom: opts.forkedFrom,
  };
}

/** Midpoint of the type's typical size range, rounded to something tidy. */
export function defaultCapacityFor(typeId: string): number {
  const type = TYPE_BY_ID[typeId];
  if (!type) return 100;
  const range = type.typicalCapacity;
  if (!range) return type.capacityUom === "SF" ? 40_000 : 100;
  const mid = (range.low + range.high) / 2;
  const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(mid)) - 1));
  return Math.round(mid / magnitude) * magnitude;
}

/** Surface parking implied by the type's parking ratio. */
function parkingArea(typeId: string, capacity: number): number {
  const type = TYPE_BY_ID[typeId];
  const ratio = type?.defaults.parkingRatio;
  if (!ratio || type.capacityUom === "SF") return 0;
  return Math.round(capacity * ratio) * 340;
}

export function makeProject(
  marketId: string,
  opts: { name?: string; typeId?: string; client?: string } = {},
): Project {
  const market = MARKET_BY_ID[marketId];
  const typeId = opts.typeId ?? typesForMarket(marketId)[0]?.id ?? "mf_wrap";
  const scheme = makeScheme(typeId, { name: "Scheme A" });
  const stamp = now();

  return {
    id: nextId("pr"),
    name: opts.name ?? `New ${market?.label ?? "Project"}`,
    client: opts.client ?? "",
    number: "",
    marketId,
    location: { address: "", city: "", index: 100 },
    schemes: [scheme],
    activeSchemeId: scheme.id,
    baselineSchemeId: scheme.id,
    settings: { ...DEFAULT_SETTINGS, adjustment: { ...DEFAULT_ADJUSTMENT } },
    overrides: [],
    decisionLog: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** Next scheme letter — A, B, C … — based on what the project already holds. */
export function nextSchemeName(project: Project): string {
  const used = new Set(
    project.schemes
      .map((s) => /^Scheme ([A-Z])$/.exec(s.name)?.[1])
      .filter((x): x is string => Boolean(x)),
  );
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) return `Scheme ${letter}`;
  }
  return `Scheme ${project.schemes.length + 1}`;
}

/** Copy a scheme, keeping its geometry and program, under a new identity. */
export function forkScheme(scheme: Scheme, name: string): Scheme {
  const stamp = now();
  return {
    ...scheme,
    id: nextId("sc"),
    name,
    masses: scheme.masses.map((m) => ({ ...m, id: `${m.id}_${nextId("f")}` })),
    site: { ...scheme.site },
    createdAt: stamp,
    updatedAt: stamp,
    forkedFrom: scheme.id,
  };
}

/**
 * Re-seed a scheme onto a different building type.
 *
 * The type is the variable being iterated, so switching it rebuilds the program
 * and massing from the new type's defaults. Floor count is carried across when
 * the new type can plausibly hold it, because height is usually the thing the
 * user was holding constant while trying types.
 */
export function retypeScheme(scheme: Scheme, typeId: string): Scheme {
  const type = TYPE_BY_ID[typeId];
  const carriedFloors = scheme.masses[0]?.floors;
  const floors =
    carriedFloors && type && carriedFloors <= type.defaults.floors * 2 ? carriedFloors : type?.defaults.floors;

  const target = capacityFitsType(scheme.typeId, typeId)
    ? scheme.targetCapacity
    : defaultCapacityFor(typeId);

  const rebuilt = makeScheme(typeId, {
    name: scheme.name,
    targetCapacity: target,
    floors,
    forkedFrom: scheme.forkedFrom,
  });

  return { ...rebuilt, id: scheme.id, createdAt: scheme.createdAt, note: scheme.note };
}

/** True when two types count capacity the same way, so the target carries over. */
function capacityFitsType(fromTypeId: string, toTypeId: string): boolean {
  const a = TYPE_BY_ID[fromTypeId];
  const b = TYPE_BY_ID[toTypeId];
  return Boolean(a && b && a.capacityUom === b.capacityUom);
}

export const activeScheme = (p: Project): Scheme | undefined =>
  p.schemes.find((s) => s.id === p.activeSchemeId) ?? p.schemes[0];

export const schemeById = (p: Project, id: string): Scheme | undefined => p.schemes.find((s) => s.id === id);
