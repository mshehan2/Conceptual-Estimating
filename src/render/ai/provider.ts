/**
 * Photoreal render providers.
 *
 * Same shape as the cost sources, and for the same reason: the vendor landscape
 * moves. Black Forest Labs deprecated the FLUX.1 Depth and Canny endpoints that
 * this feature was originally designed around, which would have been a
 * rewrite if the app had been built straight into them. Providers are therefore
 * behind one interface, and the expensive part — deriving exact depth, edge,
 * and material-mask conditioning from the 3D scene — is done once, upstream of
 * whichever provider is in use.
 */

import type { PassKind } from "../passes";

/** Conditioning images available to a provider, as PNG data URLs. */
export interface ControlImages {
  beauty: string;
  depth?: string;
  edge?: string;
  mask?: string;
  normal?: string;
}

/** How tightly the output must follow the input geometry. */
export type StructureLock = "loose" | "balanced" | "strict";

export interface RenderRequest {
  controls: ControlImages;
  /** What the building is, in the words an image model responds to. */
  prompt: string;
  negativePrompt?: string;
  structure: StructureLock;
  width: number;
  height: number;
  seed?: number;
  /** Progress callback, 0..1, best effort. */
  onProgress?: (fraction: number, note?: string) => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  /** PNG or JPEG data URL of the finished image. */
  image: string;
  providerId: string;
  model: string;
  seed?: number;
  /** Seconds the provider took, for the cost/benefit conversation. */
  elapsedSeconds: number;
}

export interface ProviderConfig {
  apiKey: string;
  /**
   * Optional proxy in front of the provider. Most image APIs do not send CORS
   * headers for browser origins, so a direct call from the page is refused;
   * pointing this at a thin pass-through solves it without touching the
   * adapter.
   */
  proxyUrl?: string;
  model?: string;
}

export type ProviderState = "unconfigured" | "ready" | "working" | "error";

export interface RenderProvider {
  readonly id: string;
  readonly label: string;
  /** One line on what this provider is good and bad at. */
  readonly summary: string;
  /** Which conditioning passes this provider can actually use. */
  readonly usesPasses: PassKind[];
  /** How hard a structure lock this provider can enforce. */
  readonly maxLock: StructureLock;
  readonly models: { id: string; label: string }[];

  configure(config: Partial<ProviderConfig>): void;
  isConfigured(): boolean;
  state(): ProviderState;
  lastError(): string | null;

  render(request: RenderRequest): Promise<RenderResult>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Strip the `data:image/png;base64,` prefix that APIs do not want. */
export function rawBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Fetch a remote image and inline it, so the result survives a signed-URL expiry. */
export async function inlineImage(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not fetch result image: ${response.status}`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read result image"));
    reader.readAsDataURL(blob);
  });
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

/**
 * Build the instruction sent to the model.
 *
 * The prompt does a lot of the structural work on instruction-following
 * providers, so it is assembled rather than left to the user: the caller
 * supplies what the building IS, and this adds what must not change.
 */
export function buildPrompt(subject: string, structure: StructureLock): string {
  const preserve =
    structure === "strict"
      ? "Preserve the exact geometry, massing, floor count, window positions and camera framing of the source image without altering them in any way."
      : structure === "balanced"
        ? "Keep the building's massing, floor count and window layout as they are in the source image."
        : "Follow the general massing and viewpoint of the source image.";

  return [
    "Photorealistic architectural visualization of the building shown in the image.",
    preserve,
    subject.trim(),
    "Natural daylight matching the direction of the shadows already present, realistic material detail, believable landscaping and context, clean professional architectural photography, high dynamic range, no text, no watermark, no signage.",
  ]
    .filter(Boolean)
    .join(" ");
}

export const DEFAULT_NEGATIVE =
  "distorted geometry, extra floors, altered window pattern, warped perspective, fisheye, text, watermark, signage, people with deformed faces, cartoon, illustration, oversaturated";
