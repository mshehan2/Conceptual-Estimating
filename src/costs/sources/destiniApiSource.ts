/**
 * Live DESTINI endpoint adapter.
 *
 * This is the answer to "make a live API achievable later": the class is
 * complete. It is not a stub with `throw new Error("TODO")` in it — it fetches,
 * maps, caches, reports status, and refreshes. What it lacks is a URL and a
 * credential, which is configuration, not code.
 *
 * To go live:
 *   1. Set `DestiniApiConfig` (base URL + auth) in the cost-data panel or via
 *      `VITE_DESTINI_BASE_URL` / `VITE_DESTINI_TOKEN`.
 *   2. If your endpoint's JSON differs from `WireBenchmark` / `WireRate` below,
 *      edit `mapBenchmark` / `mapRate` — those two functions are the entire
 *      contract surface.
 *   3. Register the source. Nothing else in the app changes: it outranks the
 *      seed library by priority and the resolver starts preferring it.
 *
 * CORS note: a browser calls this directly, so the endpoint must send
 * `Access-Control-Allow-Origin` for the app's origin. If it cannot, put a thin
 * proxy in front of it and point `baseUrl` at the proxy — the adapter does not
 * care which it is talking to.
 */

import { BaseCostSource, PRIORITY, type SourceCapabilities, type SourceStatus } from "../source";
import type {
  ConceptualBenchmark,
  ConceptualQuery,
  Confidence,
  CostIndex,
  CostScope,
  IndexQuery,
  SourceKind,
  UnitCostLine,
  UnitCostQuery,
  Uom,
} from "../schema";

export interface DestiniApiConfig {
  /** Base URL of the DESTINI-facing service, no trailing slash. */
  baseUrl: string;
  /** Bearer token, API key, or empty when the endpoint is unauthenticated. */
  token?: string;
  /** Header the token is sent in. Defaults to Authorization: Bearer <token>. */
  authHeader?: string;
  /** Sent as-is when set, instead of `Bearer <token>`. */
  authScheme?: string;
  /** Optional dataset/database selector when the tenant hosts several. */
  dataset?: string;
  /** Request timeout, ms. */
  timeoutMs?: number;
}

/** Expected response shape for conceptual benchmarks. Adjust in `mapBenchmark`. */
export interface WireBenchmark {
  id?: string;
  market?: string;
  buildingType?: string;
  unitOfMeasure?: string;
  low?: number;
  value?: number;
  high?: number;
  scope?: string;
  indexBasis?: number;
  pricedAt?: string;
  effectiveDate?: string;
  city?: string;
  state?: string;
  region?: string;
  efficiency?: number;
  gsfPerUnit?: number;
  sampleSize?: number;
  description?: string;
}

/** Expected response shape for unit-cost lines. Adjust in `mapRate`. */
export interface WireRate {
  id?: string;
  /** BUD rate key when the service already speaks our vocabulary. */
  key?: string;
  code?: string;
  csi?: string;
  uniformat?: string;
  description?: string;
  unitOfMeasure?: string;
  low?: number;
  value?: number;
  high?: number;
  market?: string;
  buildingType?: string;
  indexBasis?: number;
  pricedAt?: string;
  sampleSize?: number;
}

export interface WireIndex {
  city?: string;
  locationFactor?: number;
  escalationPctPerYear?: number;
  asOf?: string;
}

const UOM_ALIASES: Record<string, Uom> = {
  sf: "SF", sqft: "SF", "square foot": "SF", "square feet": "SF",
  gsf: "GSF", "gross sf": "GSF",
  lf: "LF", "linear foot": "LF", "linear feet": "LF",
  cy: "CY", "cubic yard": "CY",
  ea: "EA", each: "EA",
  ton: "TON", tons: "TON",
  stall: "STALL", stalls: "STALL", space: "STALL",
  unit: "UNIT", units: "UNIT", apartment: "UNIT",
  key: "KEY", keys: "KEY", room: "KEY",
  bed: "BED", beds: "BED",
  seat: "SEAT", seats: "SEAT",
  student: "STUDENT", students: "STUDENT",
  ls: "LS", "lump sum": "LS",
};

export const normalizeUom = (raw: string | undefined, fallback: Uom = "SF"): Uom => {
  if (!raw) return fallback;
  const k = raw.trim().toLowerCase().replace(/^\$\s*\/\s*/, "");
  return UOM_ALIASES[k] ?? fallback;
};

const normalizeScope = (raw: string | undefined): CostScope => {
  const k = (raw ?? "").trim().toLowerCase();
  if (k.startsWith("direct") || k.startsWith("trade")) return "direct";
  if (k.startsWith("project") || k.startsWith("total")) return "project";
  return "construction";
};

/** A live feed with a real sample behind it earns more trust than the seed. */
const confidenceFor = (sampleSize?: number): Confidence => {
  if (sampleSize == null) return "medium";
  if (sampleSize >= 12) return "high";
  if (sampleSize >= 4) return "medium";
  return "low";
};

/** Spread a single published value into a band when the feed gives only one. */
const band = (low: number | undefined, value: number | undefined, high: number | undefined) => {
  const likely = value ?? low ?? high ?? 0;
  return {
    low: low ?? likely * 0.82,
    likely,
    high: high ?? likely * 1.22,
  };
};

export class DestiniApiSource extends BaseCostSource {
  readonly id: string;
  readonly kind: SourceKind = "destini-api";
  readonly label: string;
  readonly priority = PRIORITY.liveApi;

  private config: DestiniApiConfig;
  private state: SourceStatus = { state: "unconfigured", detail: "No endpoint configured" };
  private benchmarks: ConceptualBenchmark[] | null = null;
  private rates: UnitCostLine[] | null = null;
  private inflight: Promise<void> | null = null;

  constructor(config: DestiniApiConfig, opts: { id?: string; label?: string } = {}) {
    super();
    this.id = opts.id ?? "destini";
    this.label = opts.label ?? "DESTINI (live)";
    this.config = config;
    if (config.baseUrl) this.state = { state: "empty", detail: "Not yet loaded" };
  }

  override capabilities(): SourceCapabilities {
    return { conceptual: true, unitCosts: true, indices: true, refreshable: true, writable: false };
  }

  override status(): SourceStatus {
    return this.state;
  }

  configure(config: Partial<DestiniApiConfig>): void {
    this.config = { ...this.config, ...config };
    this.benchmarks = null;
    this.rates = null;
    this.inflight = null;
    this.state = this.config.baseUrl
      ? { state: "empty", detail: "Not yet loaded" }
      : { state: "unconfigured", detail: "No endpoint configured" };
  }

  isConfigured(): boolean {
    return Boolean(this.config.baseUrl);
  }

  override async init(): Promise<void> {
    if (!this.isConfigured()) return;
    if (this.benchmarks && this.rates) return;
    if (this.inflight) return this.inflight;
    this.inflight = this.load();
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  override async refresh(): Promise<void> {
    this.benchmarks = null;
    this.rates = null;
    this.inflight = null;
    await this.init();
  }

  private async load(): Promise<void> {
    this.state = { state: "loading", detail: "Contacting DESTINI…" };
    try {
      const [wireBenchmarks, wireRates] = await Promise.all([
        this.get<WireBenchmark[]>("/conceptual-benchmarks"),
        this.get<WireRate[]>("/unit-costs"),
      ]);
      this.benchmarks = (wireBenchmarks ?? []).map((w, i) => this.mapBenchmark(w, i));
      this.rates = (wireRates ?? []).map((w, i) => this.mapRate(w, i)).filter((r): r is UnitCostLine => r !== null);
      this.state = {
        state: "ready",
        detail: `${this.benchmarks.length} benchmarks · ${this.rates.length} rates`,
      };
    } catch (err) {
      this.benchmarks = [];
      this.rates = [];
      this.state = { state: "error", detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async get<T>(path: string): Promise<T | null> {
    const { baseUrl, token, authHeader, authScheme, dataset, timeoutMs = 20_000 } = this.config;
    const url = new URL(baseUrl.replace(/\/$/, "") + path);
    if (dataset) url.searchParams.set("dataset", dataset);

    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers[authHeader ?? "Authorization"] = authScheme ? `${authScheme} ${token}` : `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), { headers, signal: controller.signal });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${path}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // -------------------------------------------------------------------------
  // The entire contract surface: change these two if your JSON differs.
  // -------------------------------------------------------------------------

  private mapBenchmark(w: WireBenchmark, i: number): ConceptualBenchmark {
    const { low, likely, high } = band(w.low, w.value, w.high);
    const pricedAt = w.pricedAt ?? w.effectiveDate ?? new Date().toISOString().slice(0, 10);
    return {
      id: w.id ?? `${this.id}:bench:${i}`,
      marketId: w.market ?? "",
      typeId: w.buildingType || undefined,
      uom: normalizeUom(w.unitOfMeasure, "GSF"),
      low,
      likely,
      high,
      scope: normalizeScope(w.scope),
      indexBasis: w.indexBasis ?? 100,
      pricedAt,
      geo: w.city || w.state || w.region ? { city: w.city, state: w.state, region: w.region } : undefined,
      efficiency: w.efficiency,
      gsfPerCapacity: w.gsfPerUnit,
      label: w.description,
      provenance: {
        sourceId: this.id,
        sourceLabel: this.label,
        sourceKind: this.kind,
        externalId: w.id,
        asOf: pricedAt,
        basis: w.description,
        sampleSize: w.sampleSize,
        confidence: confidenceFor(w.sampleSize),
      },
    };
  }

  private mapRate(w: WireRate, i: number): UnitCostLine | null {
    const key = w.key ?? w.code;
    if (!key) return null;
    const { low, likely, high } = band(w.low, w.value, w.high);
    const pricedAt = w.pricedAt ?? new Date().toISOString().slice(0, 10);
    return {
      id: w.id ?? `${this.id}:rate:${i}`,
      key,
      label: w.description ?? key,
      uom: normalizeUom(w.unitOfMeasure, "SF"),
      low,
      likely,
      high,
      csi: w.csi,
      uniformat: w.uniformat,
      marketId: w.market || undefined,
      typeId: w.buildingType || undefined,
      indexBasis: w.indexBasis ?? 100,
      pricedAt,
      provenance: {
        sourceId: this.id,
        sourceLabel: this.label,
        sourceKind: this.kind,
        externalId: w.id ?? w.code,
        asOf: pricedAt,
        sampleSize: w.sampleSize,
        confidence: confidenceFor(w.sampleSize),
      },
    };
  }

  // -------------------------------------------------------------------------

  override async conceptual(query: ConceptualQuery): Promise<ConceptualBenchmark[]> {
    await this.init();
    return (this.benchmarks ?? []).filter((b) => {
      if (query.marketId && b.marketId && b.marketId !== query.marketId) return false;
      if (query.typeId && b.typeId && b.typeId !== query.typeId) return false;
      if (query.scope && b.scope !== query.scope) return false;
      if (query.uom && b.uom !== query.uom) return false;
      return true;
    });
  }

  override async unitCosts(query: UnitCostQuery): Promise<UnitCostLine[]> {
    await this.init();
    const wanted = query.keys ? new Set(query.keys) : null;
    return (this.rates ?? []).filter((r) => {
      if (wanted && !wanted.has(r.key)) return false;
      if (query.marketId && r.marketId && r.marketId !== query.marketId) return false;
      if (query.typeId && r.typeId && r.typeId !== query.typeId) return false;
      return true;
    });
  }

  override async indices(query: IndexQuery): Promise<CostIndex | null> {
    if (!this.isConfigured() || !query.geo.city) return null;
    try {
      const w = await this.get<WireIndex>(`/indices?city=${encodeURIComponent(query.geo.city)}`);
      if (!w || w.locationFactor == null) return null;
      return {
        location: w.locationFactor,
        escalationPctPerYear: w.escalationPctPerYear ?? 4,
        city: w.city ?? query.geo.city,
        provenance: {
          sourceId: this.id,
          sourceLabel: this.label,
          sourceKind: this.kind,
          asOf: w.asOf,
          confidence: "high",
        },
      };
    } catch {
      return null;
    }
  }
}

/** Build a source from Vite env vars, so a deployment can wire itself up. */
export function destiniFromEnv(): DestiniApiSource {
  const env = (import.meta as any).env ?? {};
  return new DestiniApiSource({
    baseUrl: env.VITE_DESTINI_BASE_URL ?? "",
    token: env.VITE_DESTINI_TOKEN ?? "",
    dataset: env.VITE_DESTINI_DATASET ?? "",
  });
}
