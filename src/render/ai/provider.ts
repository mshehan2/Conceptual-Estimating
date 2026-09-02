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
  const response = await call(url, { signal });
  if (!response.ok) throw new Error(`Could not fetch result image: ${response.status}`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read result image"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Route an absolute provider URL through a configured proxy.
 *
 * Every one of these APIs hands back absolute URLs mid-flight — a polling
 * location on a regional host, then a signed image on a delivery host — and
 * each is a separate cross-origin request. Proxying only the first call and
 * then following those two directly is the same failure twice over, one step
 * later, which is exactly what used to happen.
 *
 * Two forms are accepted. `{url}` anywhere in the proxy string is replaced
 * with the encoded target, which works for any upstream host and is what the
 * bundled dev proxy wants. Otherwise the proxy is treated as a stand-in for
 * the provider's origin and the target's path is appended.
 */
export function via(url: string, proxyUrl?: string): string {
  const proxy = proxyUrl?.trim();
  if (!proxy) return url;
  if (proxy.includes("{url}")) return proxy.replace("{url}", encodeURIComponent(url));
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  return proxy.replace(/\/$/, "") + path;
}

/**
 * Fetch, reporting a blocked request as the configuration problem it is.
 *
 * A cross-origin fetch the browser refuses to send rejects with a TypeError
 * carrying no status and no body — "Failed to fetch". That reads like the
 * provider turned us away, and it is the opposite: nothing ever left the
 * machine. Saying so, and saying what to do about it, is the difference
 * between a five-minute fix and an afternoon spent re-pasting a good key.
 */
export async function call(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new Error(blockedMessage(url, err));
  }
}

export function blockedMessage(url: string, err?: unknown): string {
  // Guarded because this has to be readable from a test runner as well as a
  // browser, and an explanation that throws while explaining is no use.
  const here = typeof location !== "undefined" ? location : undefined;
  const host = (() => {
    try {
      return new URL(url, here?.href ?? "http://localhost").host;
    } catch {
      return url;
    }
  })();

  const sameOrigin = here != null && host === here.host;
  const detail = err instanceof Error && err.message ? ` (${err.message})` : "";

  if (sameOrigin) {
    return `The proxy at ${host} did not answer${detail}. If this is the bundled dev proxy, the app has to be served by \`npm run dev\` or \`npm run preview\` for it to exist.`;
  }

  return (
    `The browser blocked the request to ${host} before it was sent${detail}, so this is not your API key — no request reached the provider. ` +
    `Image APIs send no CORS headers, and a hosted build additionally forbids calls to outside hosts. ` +
    `Run the app locally with \`npm run dev\` and set Proxy URL to /ai-proxy?url={url}.`
  );
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
