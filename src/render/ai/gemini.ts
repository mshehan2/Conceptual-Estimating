/**
 * Google Gemini image models.
 *
 * The simplest of the three to wire — one synchronous call, no polling — and
 * good at instruction-led editing. Same caveat as Kontext: structure is held by
 * instruction, so it is reliable on massing and atmosphere and less reliable on
 * an exact floor count.
 */

import type { PassKind } from "../passes";
import {
  buildPrompt,
  rawBase64,
  type ProviderConfig,
  type ProviderState,
  type RenderProvider,
  type RenderRequest,
  type RenderResult,
  type StructureLock,
} from "./provider";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  error?: { message?: string };
}

export class GeminiImageProvider implements RenderProvider {
  readonly id = "gemini";
  readonly label = "Google Gemini image";
  readonly summary = "Single synchronous call, strong instruction-following. Softer structure lock.";
  readonly usesPasses: PassKind[] = ["beauty"];
  readonly maxLock: StructureLock = "balanced";
  readonly models = [{ id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image" }];

  private config: ProviderConfig = { apiKey: "", model: "gemini-2.5-flash-image" };
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

  async render(request: RenderRequest): Promise<RenderResult> {
    if (!this.isConfigured()) throw new Error("No API key set for Gemini");
    const started = Date.now();
    this.status = "working";
    this.error = null;
    const model = this.config.model ?? this.models[0].id;
    const base = (this.config.proxyUrl?.trim() || DEFAULT_BASE).replace(/\/$/, "");

    try {
      request.onProgress?.(0.15, "Rendering");
      const response = await fetch(`${base}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.config.apiKey },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: buildPrompt(request.prompt, request.structure) },
                { inline_data: { mime_type: "image/png", data: rawBase64(request.controls.beauty) } },
              ],
            },
          ],
        }),
        signal: request.signal,
      });

      const body = (await response.json()) as GeminiResponse;
      if (!response.ok) throw new Error(body.error?.message ?? `Gemini returned ${response.status}`);

      const parts = body.candidates?.[0]?.content?.parts ?? [];
      const image = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
      const data = image?.inlineData?.data ?? image?.inline_data?.data;
      if (!data) throw new Error("Gemini returned no image");

      const mime = image?.inlineData?.mimeType ?? image?.inline_data?.mime_type ?? "image/png";
      this.status = "ready";
      request.onProgress?.(1, "Done");
      return {
        image: `data:${mime};base64,${data}`,
        providerId: this.id,
        model,
        seed: request.seed,
        elapsedSeconds: (Date.now() - started) / 1000,
      };
    } catch (err) {
      this.status = "error";
      this.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }
}
