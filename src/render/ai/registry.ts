/**
 * Provider registry.
 *
 * Keys never go in the project file — a project gets emailed around, and an
 * image-generation key is a billable credential. They live in this browser.
 */

import { FluxKontextProvider } from "./flux";
import { GeminiImageProvider } from "./gemini";
import { ReplicateProvider } from "./replicate";
import type { ProviderConfig, RenderProvider } from "./provider";

export const fluxProvider = new FluxKontextProvider();
export const replicateProvider = new ReplicateProvider();
export const geminiProvider = new GeminiImageProvider();

export const PROVIDERS: RenderProvider[] = [fluxProvider, replicateProvider, geminiProvider];

export const providerById = (id: string): RenderProvider | undefined =>
  PROVIDERS.find((p) => p.id === id);

const STORAGE_KEY = "bud.render.providers";

type StoredConfigs = Record<string, Partial<ProviderConfig> & { version?: string }>;

export function loadProviderConfigs(): StoredConfigs {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as StoredConfigs;
  } catch {
    return {};
  }
}

export function saveProviderConfig(id: string, config: Partial<ProviderConfig> & { version?: string }): void {
  try {
    const all = loadProviderConfigs();
    all[id] = { ...all[id], ...config };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable; the session still works */
  }
}

export function clearProviderConfig(id: string): void {
  try {
    const all = loadProviderConfigs();
    delete all[id];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* nothing to do */
  }
}

// Restore saved configuration on load.
if (typeof localStorage !== "undefined") {
  const stored = loadProviderConfigs();
  for (const provider of PROVIDERS) {
    const config = stored[provider.id];
    if (config) provider.configure(config as ProviderConfig);
  }
}
