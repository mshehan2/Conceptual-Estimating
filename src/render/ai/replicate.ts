/**
 * Replicate — true depth and edge conditioning.
 *
 * This is the provider to reach for when the geometry must not move. Unlike
 * instruction-led editing, a ControlNet-conditioned model is constrained by the
 * depth and line images directly, so the floor count and window grid in the
 * output are the ones that were priced. It costs more setup: you pick a model
 * version, and the input field names belong to that model rather than to
 * Replicate.
 *
 * Asynchronous: POST a prediction, poll its `urls.get` until it succeeds.
 */

import type { PassKind } from "../passes";
import {
  call,
  via,
  DEFAULT_NEGATIVE,
  buildPrompt,
  inlineImage,
  sleep,
  type ProviderConfig,
  type ProviderState,
  type RenderProvider,
  type RenderRequest,
  type RenderResult,
  type StructureLock,
} from "./provider";

const DEFAULT_BASE = "https://api.replicate.com/v1";

/** Conditioning strength, rising with the requested lock. */
const CONDITIONING: Record<StructureLock, number> = {
  loose: 0.55,
  balanced: 0.8,
  strict: 1.0,
};

/** Denoising strength: lower keeps more of the source image. */
const DENOISE: Record<StructureLock, number> = {
  loose: 0.85,
  balanced: 0.65,
  strict: 0.5,
};

interface PredictionResponse {
  id?: string;
  status?: string;
  output?: string | string[] | null;
  error?: string | null;
  urls?: { get?: string; cancel?: string };
}

export interface ReplicateConfig extends ProviderConfig {
  /** Model version hash, or `owner/name` for an official model. */
  version?: string;
}

export class ReplicateProvider implements RenderProvider {
  readonly id = "replicate";
  readonly label = "Replicate (depth + edge)";
  readonly summary =
    "ControlNet conditioning on the exact depth and linework from the model. Hardest geometry lock; needs a model version.";
  readonly usesPasses: PassKind[] = ["beauty", "depth", "edge"];
  readonly maxLock: StructureLock = "strict";
  readonly models = [
    { id: "depth", label: "Depth-conditioned" },
    { id: "edge", label: "Edge-conditioned" },
    { id: "both", label: "Depth + edge" },
  ];

  private config: ReplicateConfig = { apiKey: "", model: "depth", version: "" };
  private status: ProviderState = "unconfigured";
  private error: string | null = null;

  configure(config: Partial<ReplicateConfig>): void {
    this.config = { ...this.config, ...config };
    this.status = this.config.apiKey && this.config.version ? "ready" : "unconfigured";
    this.error = null;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.version);
  }

  state(): ProviderState {
    return this.status;
  }

  lastError(): string | null {
    return this.error;
  }

  private base(): string {
    return DEFAULT_BASE;
  }

  /** Send this URL through the configured proxy, if there is one. */
  private via(url: string): string {
    return via(url, this.config.proxyUrl);
  }

  /**
   * Contract surface. Replicate passes `input` straight through to the model,
   * so these field names belong to whichever version is configured — change
   * them here to match it.
   */
  private buildInput(request: RenderRequest): Record<string, unknown> {
    const which = this.config.model ?? "depth";
    const control =
      which === "edge"
        ? request.controls.edge
        : which === "both"
          ? request.controls.depth
          : request.controls.depth;

    return {
      prompt: buildPrompt(request.prompt, request.structure),
      negative_prompt: request.negativePrompt ?? DEFAULT_NEGATIVE,
      image: request.controls.beauty,
      control_image: control ?? request.controls.beauty,
      // Some ControlNet models take a second conditioning channel.
      ...(which === "both" && request.controls.edge ? { control_image_2: request.controls.edge } : {}),
      controlnet_conditioning_scale: CONDITIONING[request.structure],
      prompt_strength: DENOISE[request.structure],
      width: request.width,
      height: request.height,
      seed: request.seed,
      num_inference_steps: 30,
    };
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    if (!this.isConfigured()) throw new Error("Replicate needs both an API token and a model version");

    const started = Date.now();
    this.status = "working";
    this.error = null;

    try {
      request.onProgress?.(0.05, "Submitting");
      const version = this.config.version!;
      const body = version.includes("/")
        ? { input: this.buildInput(request) }
        : { version, input: this.buildInput(request) };
      const endpoint = version.includes("/")
        ? `${this.base()}/models/${version}/predictions`
        : `${this.base()}/predictions`;

      const submit = await call(this.via(endpoint), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });
      if (!submit.ok) throw new Error(await httpError(submit));

      const prediction = (await submit.json()) as PredictionResponse;
      const pollUrl = prediction.urls?.get ?? `${this.base()}/predictions/${prediction.id}`;

      const deadline = Date.now() + 240_000;
      let attempt = 0;
      while (Date.now() < deadline) {
        await sleep(attempt === 0 ? 1500 : 2500, request.signal);
        attempt++;

        // Replicate hands back an absolute polling URL, which needs the
        // proxy exactly as much as the submit did.
        const poll = await call(this.via(pollUrl), {
          headers: { Authorization: `Bearer ${this.config.apiKey}` },
          signal: request.signal,
        });
        if (!poll.ok) throw new Error(await httpError(poll));
        const state = (await poll.json()) as PredictionResponse;

        request.onProgress?.(Math.min(0.9, 0.15 + attempt * 0.05), state.status ?? "Rendering");

        if (state.status === "succeeded") {
          const url = Array.isArray(state.output) ? state.output[state.output.length - 1] : state.output;
          if (!url) throw new Error("Prediction succeeded with no output image");
          request.onProgress?.(0.95, "Downloading");
          const image = await inlineImage(this.via(url), request.signal);
          this.status = "ready";
          request.onProgress?.(1, "Done");
          return {
            image,
            providerId: this.id,
            model: this.config.model ?? "depth",
            seed: request.seed,
            elapsedSeconds: (Date.now() - started) / 1000,
          };
        }
        if (state.status === "failed" || state.status === "canceled") {
          throw new Error(state.error || `Prediction ${state.status}`);
        }
      }
      throw new Error("Timed out waiting for the prediction");
    } catch (err) {
      this.status = "error";
      this.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }
}

async function httpError(response: Response): Promise<string> {
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 300);
  } catch {
    /* unreadable body */
  }
  if (response.status === 401) return "Replicate rejected the API token.";
  if (response.status === 402) return "Replicate reports insufficient credit.";
  if (response.status === 422) return `Replicate rejected the inputs: ${detail}`;
  return `Replicate returned ${response.status}${detail ? `: ${detail}` : ""}`;
}
