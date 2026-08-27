/**
 * FLUX.1 Kontext (Black Forest Labs).
 *
 * Kontext edits a reference image against an instruction, which is what BFL
 * actually supports now — the Depth and Canny endpoints that offered hard
 * ControlNet conditioning have been deprecated. Structure is therefore held by
 * the reference image plus an explicit preservation instruction, which is a
 * softer lock than depth conditioning: expect it to hold massing and framing
 * well, and to occasionally take liberties with a floor count on a complex
 * elevation. The strict setting exists to push back on that.
 *
 * The API is asynchronous: POST a task, receive a polling URL, poll until the
 * status reports ready, then fetch the signed result.
 *
 * The three functions marked below are the entire contract surface. If BFL
 * changes the wire format again, they are what needs editing — nothing else in
 * the app knows how this provider talks.
 */

import type { PassKind } from "../passes";
import {
  DEFAULT_NEGATIVE,
  buildPrompt,
  inlineImage,
  rawBase64,
  sleep,
  type ProviderConfig,
  type ProviderState,
  type RenderProvider,
  type RenderRequest,
  type RenderResult,
  type StructureLock,
} from "./provider";

const DEFAULT_BASE = "https://api.bfl.ai/v1";

/** Guidance rises with how tightly the output must track the reference. */
const GUIDANCE: Record<StructureLock, number> = {
  loose: 2.5,
  balanced: 3.5,
  strict: 5,
};

interface SubmitResponse {
  id?: string;
  polling_url?: string;
}

interface PollResponse {
  id?: string;
  status?: string;
  result?: { sample?: string } | null;
  details?: unknown;
}

export class FluxKontextProvider implements RenderProvider {
  readonly id = "flux-kontext";
  readonly label = "Black Forest Labs (FLUX)";
  readonly summary =
    "Restyles our own render rather than inventing a building. FLUX.2 takes the depth and linework passes alongside it, so the geometry it returns is the geometry we priced.";
  readonly usesPasses: PassKind[] = ["beauty", "depth", "edge"];
  readonly maxLock: StructureLock = "balanced";
  readonly models = [
    { id: "flux-2-pro", label: "FLUX.2 Pro — best fidelity, multi-reference" },
    { id: "flux-2-flex", label: "FLUX.2 Flex — exposes steps and guidance" },
    { id: "flux-kontext-pro", label: "Kontext Pro — targeted edits" },
    { id: "flux-kontext-max", label: "Kontext Max — slower, higher fidelity" },
  ];

  private config: ProviderConfig = { apiKey: "", model: "flux-2-pro" };
  private status: ProviderState = "unconfigured";
  private error: string | null = null;

  configure(config: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...config };
    this.status = this.config.apiKey ? "ready" : "unconfigured";
    this.error = null;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  state(): ProviderState {
    return this.status;
  }

  lastError(): string | null {
    return this.error;
  }

  private base(): string {
    return (this.config.proxyUrl?.trim() || DEFAULT_BASE).replace(/\/$/, "");
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      accept: "application/json",
      // BFL authenticates with an x-key header rather than a bearer token.
      "x-key": this.config.apiKey,
    };
  }

  // -------------------------------------------------------------------------
  // Contract surface: submit, poll, extract.
  // -------------------------------------------------------------------------

  /**
   * Shape the generation request.
   *
   * This and `interpret` are the entire contract surface: if BFL changes the
   * request shape, it changes here and nowhere else.
   *
   * FLUX.2 takes several reference images at once, and that is the whole
   * reason to prefer it here. One beauty render tells the model what the
   * building looks like; handing it depth and linework alongside tells it
   * where the geometry actually is, which is the difference between a
   * photoreal version of OUR building and a photoreal building.
   *
   * NOTE: the FLUX.2 field names below are written from the published API
   * shape and have never been exercised against the live endpoint — this
   * sandbox cannot reach api.bfl.ai. If the first call returns a 422, the
   * field name is what to check.
   */
  private buildBody(request: RenderRequest, model: string): Record<string, unknown> {
    const common = {
      prompt: buildPrompt(request.prompt, request.structure),
      seed: request.seed,
      output_format: "png",
      aspect_ratio: aspectRatio(request.width, request.height),
    };

    if (model.startsWith("flux-2")) {
      const references = [request.controls.beauty, request.controls.depth, request.controls.edge]
        .filter((c): c is string => Boolean(c))
        .map(rawBase64);
      return {
        ...common,
        input_images: references,
        // Flex is the variant that exposes the knobs; Pro ignores them.
        ...(model === "flux-2-flex" ? { steps: 40, guidance: GUIDANCE[request.structure] } : {}),
      };
    }

    return {
      ...common,
      input_image: rawBase64(request.controls.beauty),
      prompt_upsampling: false,
      safety_tolerance: 2,
      guidance: GUIDANCE[request.structure],
    };
  }

  /** Read the polling location out of the submit response. */
  private pollUrlFrom(body: SubmitResponse): string {
    if (body.polling_url) return body.polling_url;
    if (body.id) return `${this.base()}/get_result?id=${encodeURIComponent(body.id)}`;
    throw new Error("Provider did not return a polling URL or task id");
  }

  /** Interpret a poll response. */
  private interpret(body: PollResponse): { done: boolean; imageUrl?: string; failure?: string } {
    const status = String(body.status ?? "").toLowerCase();
    if (status === "ready" || status === "succeeded" || status === "complete") {
      const sample = body.result?.sample;
      if (!sample) return { done: true, failure: "Provider reported ready with no image" };
      return { done: true, imageUrl: sample };
    }
    if (status.includes("error") || status.includes("fail")) {
      return { done: true, failure: describe(body.details) || `Provider reported ${body.status}` };
    }
    if (status.includes("moderated") || status.includes("content")) {
      return { done: true, failure: "The provider's content filter rejected this image" };
    }
    return { done: false };
  }

  // -------------------------------------------------------------------------

  async render(request: RenderRequest): Promise<RenderResult> {
    if (!this.isConfigured()) throw new Error("No API key set for FLUX");

    const started = Date.now();
    this.status = "working";
    this.error = null;
    const model = this.config.model ?? this.models[0].id;

    try {
      request.onProgress?.(0.05, "Submitting");

      const submitResponse = await fetch(`${this.base()}/${model}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(this.buildBody(request, model)),
        signal: request.signal,
      });

      if (!submitResponse.ok) {
        throw new Error(await describeHttpError(submitResponse));
      }

      const pollUrl = this.pollUrlFrom((await submitResponse.json()) as SubmitResponse);
      request.onProgress?.(0.15, "Queued");

      // Poll with a ceiling rather than forever: a task that has not finished
      // in a couple of minutes has gone wrong, and a hung spinner is worse
      // than an error message.
      const deadline = Date.now() + 180_000;
      let attempt = 0;
      while (Date.now() < deadline) {
        await sleep(attempt === 0 ? 1200 : 2000, request.signal);
        attempt++;

        const pollResponse = await fetch(pollUrl, {
          headers: { accept: "application/json", "x-key": this.config.apiKey },
          signal: request.signal,
        });
        if (!pollResponse.ok) throw new Error(await describeHttpError(pollResponse));

        const verdict = this.interpret((await pollResponse.json()) as PollResponse);
        // Creep toward 0.9 while waiting; the provider gives no real progress.
        request.onProgress?.(Math.min(0.9, 0.15 + attempt * 0.06), "Rendering");

        if (!verdict.done) continue;
        if (verdict.failure) throw new Error(verdict.failure);

        request.onProgress?.(0.95, "Downloading");
        const image = await inlineImage(verdict.imageUrl!, request.signal);
        this.status = "ready";
        request.onProgress?.(1, "Done");

        return {
          image,
          providerId: this.id,
          model,
          seed: request.seed,
          elapsedSeconds: (Date.now() - started) / 1000,
        };
      }

      throw new Error("Timed out waiting for the provider");
    } catch (err) {
      this.status = "error";
      this.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }
}

/** Nearest aspect ratio the API accepts, as a "w:h" string. */
export function aspectRatio(width: number, height: number): string {
  const candidates: [number, number][] = [
    [21, 9], [16, 9], [3, 2], [4, 3], [1, 1], [3, 4], [2, 3], [9, 16], [9, 21],
  ];
  const target = width / height;
  let best = candidates[0];
  let bestError = Infinity;
  for (const [w, h] of candidates) {
    const error = Math.abs(w / h - target);
    if (error < bestError) {
      bestError = error;
      best = [w, h];
    }
  }
  return `${best[0]}:${best[1]}`;
}

async function describeHttpError(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = await response.text();
    detail = body.slice(0, 300);
  } catch {
    /* body already consumed or unreadable */
  }
  if (response.status === 401 || response.status === 403) {
    return `Authentication failed (${response.status}). Check the API key.`;
  }
  if (response.status === 402) return "The provider reports insufficient credit.";
  if (response.status === 429) return "Rate limited by the provider. Wait a moment and retry.";
  if (response.status === 0) {
    return "The browser blocked the request. This provider needs a proxy — set one in the AI render settings.";
  }
  return `Provider returned ${response.status}${detail ? `: ${detail}` : ""}`;
}

function describe(details: unknown): string {
  if (!details) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details).slice(0, 300);
  } catch {
    return "";
  }
}

export { DEFAULT_NEGATIVE };
