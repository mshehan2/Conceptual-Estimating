/**
 * Project store.
 *
 * Holds the project, drives estimate recomputation, and persists to this
 * browser. Estimates are async because a cost source may be a network call, so
 * they are computed off to the side and published when they land rather than
 * being derived synchronously during render.
 */

import { create } from "zustand";
import type { Mass } from "@/domain/massing";
import type { SchemeEstimate } from "@/domain/estimate";
import { estimateScheme } from "@/domain/estimate";
import { takeoff } from "@/domain/takeoff";
import {
  activeScheme,
  forkScheme,
  makeProject,
  makeScheme,
  nextSchemeName,
  retypeScheme,
  type DecisionLogEntry,
  type Project,
  type ProjectSettings,
  type Scheme,
} from "@/domain/project";
import { seedProgramForType, fitFootprint } from "@/domain/program";
import { makeMassForType } from "@/domain/massing";
import { TYPE_BY_ID, typesForMarket } from "@/markets/registry";
import { nearestCity, cityIndex } from "@/costs/seed/locations";
import type { FootprintShape, Point } from "@/domain/footprint";
import { overrideSource, resolver } from "./costSources";
import type { Uom } from "@/costs/schema";

const STORAGE_KEY = "bud.project.v1";

export interface ProjectState {
  project: Project;
  /** Estimate per scheme id. Recomputed whenever inputs change. */
  estimates: Record<string, SchemeEstimate>;
  estimating: boolean;
  /** Bumped whenever a cost source changes, to force re-estimation. */
  sourceRevision: number;

  // --- project ---
  newProject: (marketId: string, typeId?: string) => void;
  loadProject: (project: Project) => void;
  patchProject: (patch: Partial<Project>) => void;
  setMarket: (marketId: string) => void;
  setLocation: (address: string, lat?: number, lon?: number) => void;
  setLocationCity: (city: string) => void;
  patchSettings: (patch: Partial<ProjectSettings>) => void;
  addLogEntry: (text: string) => void;

  // --- schemes ---
  setActiveScheme: (id: string) => void;
  setBaselineScheme: (id: string) => void;
  addScheme: (typeId?: string) => void;
  duplicateScheme: (id: string) => void;
  removeScheme: (id: string) => void;
  renameScheme: (id: string, name: string) => void;
  setSchemeType: (id: string, typeId: string) => void;
  setSchemeCapacity: (id: string, target: number) => void;
  patchScheme: (id: string, patch: Partial<Scheme>) => void;

  // --- masses ---
  patchMass: (schemeId: string, massId: string, patch: Partial<Mass>) => void;
  /**
   * Change a mass's plan shape, keeping its bounding box in step.
   *
   * Width and depth are the size half of a footprint and the shape is the rest,
   * so a hand-drawn polygon that no longer matches its stated bounds would put
   * every downstream consumer — area, envelope, camera framing — slightly out.
   */
  /**
   * @param recenter Re-derive the bounding box and re-centre the points.
   *   Must be false during a drag: recentring moves every point under the
   *   cursor mid-gesture, so the offset captured on pointer-down no longer
   *   matches the vertex and it runs away from the pointer.
   */
  setMassShape: (schemeId: string, massId: string, shape: FootprintShape, recenter?: boolean) => void;
  addMass: (schemeId: string, typeId?: string) => void;
  removeMass: (schemeId: string, massId: string) => void;

  // --- cost sources ---
  setOverride: (key: string, value: number, uom: Uom, label?: string) => void;
  clearOverride: (key: string) => void;
  bumpSources: () => void;

  recompute: () => void;
}

const stamp = () => new Date().toISOString();

/** Bounding box of a drawn ring, in feet. */
function pointsBounds(points: Point[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
}

/** Persisted shape. Estimates are derived, so only the project is written. */
function persist(project: Project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    /* over quota or unavailable — the session continues, it just won't restore */
  }
}

function restore(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Project;
    // A stored project from an older shape is better discarded than half-read.
    if (!p?.schemes?.length || !p.marketId) return null;
    return p;
  } catch {
    return null;
  }
}

let recomputeTimer: ReturnType<typeof setTimeout> | null = null;
let recomputeToken = 0;

export const useProject = create<ProjectState>((set, get) => {
  /** Recompute every scheme's estimate, publishing when the last one lands. */
  const scheduleRecompute = () => {
    if (recomputeTimer) clearTimeout(recomputeTimer);
    set({ estimating: true });
    recomputeTimer = setTimeout(async () => {
      const token = ++recomputeToken;
      const { project } = get();
      overrideSource.loadJSON(project.overrides);

      const entries = await Promise.all(
        project.schemes.map(async (scheme) => {
          const t = takeoff(scheme.masses, {
            circulation: project.settings.circulation,
            factors: project.settings.factors,
            site: scheme.site,
          });
          const est = await estimateScheme(t, resolver, {
            marketId: TYPE_BY_ID[scheme.typeId]?.marketId ?? project.marketId,
            typeId: scheme.typeId,
            indirects: project.settings.indirects,
            adjustment: project.settings.adjustment,
            band: project.settings.band,
          });
          return [scheme.id, est] as const;
        }),
      );

      // A newer recompute started while this one was in flight; drop this one.
      if (token !== recomputeToken) return;
      set({ estimates: Object.fromEntries(entries), estimating: false });
    }, 60);
  };

  /** Apply a project change: stamp it, persist it, and re-estimate. */
  const commit = (updater: (p: Project) => Project) => {
    set((state) => {
      const next = { ...updater(state.project), updatedAt: stamp() };
      persist(next);
      return { project: next };
    });
    scheduleRecompute();
  };

  const mapScheme = (id: string, fn: (s: Scheme) => Scheme) => (p: Project) => ({
    ...p,
    schemes: p.schemes.map((s) => (s.id === id ? { ...fn(s), updatedAt: stamp() } : s)),
  });

  const initial = restore() ?? makeProject("senior_living");
  queueMicrotask(scheduleRecompute);

  return {
    project: initial,
    estimates: {},
    estimating: true,
    sourceRevision: 0,

    newProject: (marketId, typeId) => commit(() => makeProject(marketId, { typeId })),

    loadProject: (project) => commit(() => project),

    patchProject: (patch) => commit((p) => ({ ...p, ...patch })),

    setMarket: (marketId) =>
      commit((p) => {
        if (p.marketId === marketId) return p;
        // The market is the project's identity, so changing it re-seeds every
        // scheme onto the nearest type in the new market rather than leaving
        // schemes pointing at types the project no longer covers.
        const firstType = typesForMarket(marketId)[0]?.id;
        if (!firstType) return p;
        return {
          ...p,
          marketId,
          schemes: p.schemes.map((s) => retypeScheme(s, firstType)),
        };
      }),

    setLocation: (address, lat, lon) =>
      commit((p) => {
        const hit = lat != null && lon != null ? nearestCity(lat, lon) : null;
        return {
          ...p,
          location: {
            ...p.location,
            address,
            lat,
            lon,
            city: hit?.city ?? p.location.city,
            index: hit?.index ?? p.location.index,
            milesToIndexCity: hit?.miles,
          },
          settings: {
            ...p.settings,
            adjustment: { ...p.settings.adjustment, locationIndex: hit?.index ?? p.settings.adjustment.locationIndex, city: hit?.city },
          },
        };
      }),

    setLocationCity: (city) =>
      commit((p) => {
        const hit = cityIndex(city);
        return {
          ...p,
          location: { ...p.location, city, index: hit?.index ?? p.location.index, milesToIndexCity: 0 },
          settings: {
            ...p.settings,
            adjustment: { ...p.settings.adjustment, locationIndex: hit?.index ?? p.settings.adjustment.locationIndex, city },
          },
        };
      }),

    patchSettings: (patch) => commit((p) => ({ ...p, settings: { ...p.settings, ...patch } })),

    addLogEntry: (text) =>
      commit((p) => {
        const scheme = activeScheme(p);
        const est = scheme ? get().estimates[scheme.id] : undefined;
        const entry: DecisionLogEntry = {
          id: `dl${Date.now().toString(36)}`,
          at: stamp(),
          text,
          schemeId: scheme?.id,
          total: est?.bottomUp.project,
          gsf: est?.takeoff.gsf,
        };
        return { ...p, decisionLog: [entry, ...p.decisionLog] };
      }),

    setActiveScheme: (id) => commit((p) => ({ ...p, activeSchemeId: id })),
    setBaselineScheme: (id) => commit((p) => ({ ...p, baselineSchemeId: id })),

    addScheme: (typeId) =>
      commit((p) => {
        const type = typeId ?? activeScheme(p)?.typeId ?? typesForMarket(p.marketId)[0]?.id;
        if (!type) return p;
        const scheme = makeScheme(type, { name: nextSchemeName(p) });
        return { ...p, schemes: [...p.schemes, scheme], activeSchemeId: scheme.id };
      }),

    duplicateScheme: (id) =>
      commit((p) => {
        const source = p.schemes.find((s) => s.id === id);
        if (!source) return p;
        const copy = forkScheme(source, nextSchemeName(p));
        return { ...p, schemes: [...p.schemes, copy], activeSchemeId: copy.id };
      }),

    removeScheme: (id) =>
      commit((p) => {
        if (p.schemes.length <= 1) return p;
        const schemes = p.schemes.filter((s) => s.id !== id);
        return {
          ...p,
          schemes,
          activeSchemeId: p.activeSchemeId === id ? schemes[0].id : p.activeSchemeId,
          baselineSchemeId: p.baselineSchemeId === id ? schemes[0].id : p.baselineSchemeId,
        };
      }),

    renameScheme: (id, name) => commit(mapScheme(id, (s) => ({ ...s, name }))),

    setSchemeType: (id, typeId) => commit(mapScheme(id, (s) => retypeScheme(s, typeId))),

    setSchemeCapacity: (id, target) =>
      commit(
        mapScheme(id, (s) => {
          const clean = Math.max(1, Math.round(target));
          const seeded = seedProgramForType(s.typeId, clean);
          const floors = s.masses[0]?.floors ?? TYPE_BY_ID[s.typeId]?.defaults.floors ?? 3;
          // Resize for the plan the user is actually drawing in, not a rectangle.
          const { w, d } = fitFootprint(seeded.netArea, s.typeId, floors, 2.6, s.masses[0]?.shape);
          // Resize the primary mass to hold the new target; any additional
          // masses the user added are theirs to manage and are left alone.
          const [primary, ...rest] = s.masses;
          const resized = primary
            ? { ...primary, w, d, program: seeded.program }
            : makeMassForType(s.typeId, { w, d, floors, program: seeded.program });
          return { ...s, targetCapacity: clean, masses: [resized, ...rest] };
        }),
      ),

    patchScheme: (id, patch) => commit(mapScheme(id, (s) => ({ ...s, ...patch }))),

    setMassShape: (schemeId, massId, shape, recenter = true) =>
      commit(
        mapScheme(schemeId, (s) => ({
          ...s,
          masses: s.masses.map((m) => {
            if (m.id !== massId) return m;
            if (shape.kind !== "polygon") return { ...m, shape };
            // Mid-drag: take the points as given and leave the frame alone.
            if (!recenter) return { ...m, shape };
            // Re-derive the bounds from the drawn points, and re-centre them so
            // the mass keeps rotating about its own middle.
            const bounds = pointsBounds(shape.points);
            const w = Math.max(4, bounds.maxX - bounds.minX);
            const d = Math.max(4, bounds.maxZ - bounds.minZ);
            const cx = (bounds.minX + bounds.maxX) / 2;
            const cz = (bounds.minZ + bounds.maxZ) / 2;
            return {
              ...m,
              w,
              d,
              shape: {
                ...shape,
                points: shape.points.map(([x, z]) => [x - cx, z - cz] as [number, number]),
                holes: shape.holes?.map((h) => h.map(([x, z]) => [x - cx, z - cz] as [number, number])),
              },
            };
          }),
        })),
      ),

    patchMass: (schemeId, massId, patch) =>
      commit(
        mapScheme(schemeId, (s) => ({
          ...s,
          masses: s.masses.map((m) => (m.id === massId ? { ...m, ...patch } : m)),
        })),
      ),

    addMass: (schemeId, typeId) =>
      commit(
        mapScheme(schemeId, (s) => {
          const type = typeId ?? s.typeId;
          // Place the new mass clear of what is already there.
          const east = s.masses.reduce((a, m) => Math.max(a, m.x + m.w / 2), 0);
          const mass = makeMassForType(type, { x: east + 60, program: {} });
          return { ...s, masses: [...s.masses, mass] };
        }),
      ),

    removeMass: (schemeId, massId) =>
      commit(
        mapScheme(schemeId, (s) =>
          s.masses.length <= 1 ? s : { ...s, masses: s.masses.filter((m) => m.id !== massId) },
        ),
      ),

    setOverride: (key, value, uom, label) =>
      commit((p) => {
        overrideSource.set(key, value, uom, { label });
        return { ...p, overrides: overrideSource.toJSON() };
      }),

    clearOverride: (key) =>
      commit((p) => {
        overrideSource.clear(key);
        return { ...p, overrides: overrideSource.toJSON() };
      }),

    bumpSources: () => {
      set((s) => ({ sourceRevision: s.sourceRevision + 1 }));
      scheduleRecompute();
    },

    recompute: scheduleRecompute,
  };
});

/** The scheme currently being edited. */
export const useActiveScheme = (): Scheme | undefined =>
  useProject((s) => s.project.schemes.find((x) => x.id === s.project.activeSchemeId) ?? s.project.schemes[0]);

/** The estimate for the scheme currently being edited. */
export const useActiveEstimate = (): SchemeEstimate | undefined =>
  useProject((s) => {
    const id = s.project.activeSchemeId;
    return s.estimates[id] ?? s.estimates[s.project.schemes[0]?.id];
  });
