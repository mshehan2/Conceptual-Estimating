/**
 * The application's cost source stack.
 *
 * One resolver, four sources, registered once. Adding a live DESTINI endpoint
 * later means calling `configureDestini` with a URL — the resolver, the
 * estimate, and every provenance chip pick it up with no further change.
 */

import { CostResolver } from "@/costs/resolver";
import { SeedCostSource } from "@/costs/sources/seedSource";
import { ImportedCostSource } from "@/costs/sources/importSource";
import { OverrideCostSource } from "@/costs/sources/overrideSource";
import { DestiniApiSource, type DestiniApiConfig } from "@/costs/sources/destiniApiSource";

export const seedSource = new SeedCostSource();
export const importSource = new ImportedCostSource();
export const overrideSource = new OverrideCostSource();

const env = (import.meta as any).env ?? {};
export const destiniSource = new DestiniApiSource({
  baseUrl: env.VITE_DESTINI_BASE_URL ?? "",
  token: env.VITE_DESTINI_TOKEN ?? "",
  dataset: env.VITE_DESTINI_DATASET ?? "",
});

export const resolver = new CostResolver()
  .register(seedSource)
  .register(importSource)
  .register(destiniSource)
  .register(overrideSource);

/** Point the live source at an endpoint. Persisted by the caller, not here. */
export function configureDestini(config: Partial<DestiniApiConfig>): void {
  destiniSource.configure(config);
}

const STORAGE_KEY = "bud.destini.config";

export function loadDestiniConfig(): Partial<DestiniApiConfig> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<DestiniApiConfig>) : null;
  } catch {
    return null;
  }
}

/**
 * Endpoint settings live in this browser only, never in the project file — a
 * project gets emailed around, and a bearer token should not travel with it.
 */
export function saveDestiniConfig(config: Partial<DestiniApiConfig>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* storage unavailable; the session still works, it just won't be remembered */
  }
}

export function clearDestiniConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

// Restore a previously configured endpoint on load.
const saved = typeof localStorage !== "undefined" ? loadDestiniConfig() : null;
if (saved?.baseUrl) destiniSource.configure(saved);
