/**
 * DESTINI export importer.
 *
 * Ingests a CSV or JSON export from DESTINI Estimator / Profiler and serves it
 * through the same `CostSource` interface as everything else. Column names vary
 * between templates and tenants, so headers are matched by alias rather than by
 * exact position, and whatever it could not map is reported instead of silently
 * dropped.
 *
 * Priority sits above the seed library and below a live endpoint: a file you
 * dropped in beats built-in defaults, and a live feed beats the file.
 */

import { BaseCostSource, PRIORITY, type SourceCapabilities, type SourceStatus } from "../source";
import type {
  ConceptualBenchmark,
  ConceptualQuery,
  CostScope,
  SourceKind,
  UnitCostLine,
  UnitCostQuery,
  Uom,
} from "../schema";
import { normalizeUom } from "./destiniApiSource";

// ---------------------------------------------------------------------------
// CSV parsing (quote-aware, no dependency)
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // Strip a UTF-8 BOM, which Excel exports routinely carry.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Header aliases, lowercased and stripped of punctuation. */
const ALIASES: Record<string, string[]> = {
  key: ["key", "budkey", "ratekey", "itemkey"],
  code: ["code", "costcode", "itemcode", "linecode", "assemblycode"],
  csi: ["csi", "csicode", "masterformat", "division"],
  uniformat: ["uniformat", "uniformatcode", "element", "elementcode"],
  label: ["label", "description", "itemdescription", "name", "lineitem", "linedescription"],
  uom: ["uom", "unit", "unitofmeasure", "units", "measure"],
  low: ["low", "min", "minimum", "lowvalue", "lowcost", "p25"],
  value: ["value", "cost", "unitcost", "rate", "amount", "likely", "mean", "average", "avg", "median", "unitprice"],
  high: ["high", "max", "maximum", "highvalue", "highcost", "p75"],
  market: ["market", "sector", "marketsector"],
  type: ["type", "buildingtype", "projecttype", "subtype"],
  pricedAt: ["pricedat", "date", "effectivedate", "asof", "asofdate", "pricingdate"],
  indexBasis: ["indexbasis", "index", "locationindex", "citycostindex"],
  sampleSize: ["samplesize", "projects", "n", "count", "observations"],
  scope: ["scope", "costscope", "basis"],
  efficiency: ["efficiency", "netgross", "nettogross"],
  gsfPerCapacity: ["gsfperunit", "gsfpercapacity", "sfperunit", "areaperunit"],
};

const canon = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/** Map a header row to canonical field names. */
export function mapHeaders(headers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  headers.forEach((h, i) => {
    const c = canon(h);
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (out[field] === undefined && aliases.includes(c)) out[field] = i;
    }
  });
  return out;
}

const num = (raw: string | undefined): number | undefined => {
  if (raw == null) return undefined;
  const cleaned = raw.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (cleaned === "") return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
};

const normalizeScope = (raw?: string): CostScope => {
  const k = (raw ?? "").trim().toLowerCase();
  if (k.startsWith("direct") || k.startsWith("trade")) return "direct";
  if (k.startsWith("project") || k.startsWith("total")) return "project";
  return "construction";
};

export interface ImportReport {
  fileName: string;
  rowsRead: number;
  ratesMapped: number;
  benchmarksMapped: number;
  /** Rows that could not be mapped, with the reason. Never silently dropped. */
  skipped: { row: number; reason: string }[];
  /** Canonical fields the header row did not supply. */
  missingColumns: string[];
}

export interface ImportPayload {
  rates: UnitCostLine[];
  benchmarks: ConceptualBenchmark[];
  report: ImportReport;
}

/** Which shape a file is — a rate catalog or a set of conceptual benchmarks. */
export type ImportKind = "rates" | "benchmarks";

export class ImportedCostSource extends BaseCostSource {
  readonly id: string;
  readonly kind: SourceKind = "import";
  readonly label: string;
  readonly priority = PRIORITY.import;

  private rates: UnitCostLine[] = [];
  private benchmarks: ConceptualBenchmark[] = [];
  private report: ImportReport | null = null;

  constructor(opts: { id?: string; label?: string } = {}) {
    super();
    this.id = opts.id ?? "import";
    this.label = opts.label ?? "DESTINI export";
  }

  override capabilities(): SourceCapabilities {
    return { conceptual: true, unitCosts: true, indices: false, refreshable: false, writable: true };
  }

  override status(): SourceStatus {
    if (!this.report) return { state: "empty", detail: "No file imported" };
    const { fileName, ratesMapped, benchmarksMapped, skipped } = this.report;
    const parts = [`${fileName}`];
    if (ratesMapped) parts.push(`${ratesMapped} rates`);
    if (benchmarksMapped) parts.push(`${benchmarksMapped} benchmarks`);
    if (skipped.length) parts.push(`${skipped.length} skipped`);
    return { state: ratesMapped + benchmarksMapped > 0 ? "ready" : "error", detail: parts.join(" · ") };
  }

  lastReport(): ImportReport | null {
    return this.report;
  }

  clear(): void {
    this.rates = [];
    this.benchmarks = [];
    this.report = null;
  }

  /** Ingest a CSV or JSON export. Returns the report for display. */
  ingest(text: string, fileName: string, kind: ImportKind = "rates"): ImportReport {
    const payload = fileName.toLowerCase().endsWith(".json")
      ? this.fromJson(text, fileName, kind)
      : this.fromCsv(text, fileName, kind);
    this.rates = payload.rates;
    this.benchmarks = payload.benchmarks;
    this.report = payload.report;
    return payload.report;
  }

  private provenanceFor(fileName: string, externalId?: string, asOf?: string, sampleSize?: number) {
    return {
      sourceId: this.id,
      sourceLabel: `${this.label} · ${fileName}`,
      sourceKind: this.kind,
      externalId,
      asOf,
      basis: `Imported from ${fileName}`,
      sampleSize,
      confidence: "high" as const,
    };
  }

  private fromCsv(text: string, fileName: string, kind: ImportKind): ImportPayload {
    const rows = parseCsv(text);
    const skipped: ImportReport["skipped"] = [];
    if (rows.length < 2) {
      return {
        rates: [],
        benchmarks: [],
        report: { fileName, rowsRead: rows.length, ratesMapped: 0, benchmarksMapped: 0, skipped, missingColumns: [] },
      };
    }

    const cols = mapHeaders(rows[0]);
    const need = kind === "rates" ? ["label", "value"] : ["value"];
    const missingColumns = need.filter((f) => cols[f] === undefined);

    const rates: UnitCostLine[] = [];
    const benchmarks: ConceptualBenchmark[] = [];

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const get = (f: string) => (cols[f] === undefined ? undefined : row[cols[f]]?.trim());
      const value = num(get("value"));
      const low = num(get("low"));
      const high = num(get("high"));
      const likely = value ?? low ?? high;

      if (likely === undefined) {
        skipped.push({ row: r + 1, reason: "no numeric cost value found" });
        continue;
      }

      const pricedAt = get("pricedAt") || new Date().toISOString().slice(0, 10);
      const indexBasis = num(get("indexBasis")) ?? 100;
      const sampleSize = num(get("sampleSize"));

      if (kind === "rates") {
        const key = get("key") || get("code");
        if (!key) {
          skipped.push({ row: r + 1, reason: "no rate key or cost code — cannot match to a BUD rate" });
          continue;
        }
        rates.push({
          id: `${this.id}:rate:${r}`,
          key,
          label: get("label") || key,
          uom: normalizeUom(get("uom"), "SF"),
          low: low ?? likely * 0.82,
          likely,
          high: high ?? likely * 1.22,
          csi: get("csi"),
          uniformat: get("uniformat"),
          marketId: get("market") || undefined,
          typeId: get("type") || undefined,
          indexBasis,
          pricedAt,
          provenance: this.provenanceFor(fileName, get("code"), pricedAt, sampleSize),
        });
      } else {
        const marketId = get("market") ?? "";
        benchmarks.push({
          id: `${this.id}:bench:${r}`,
          marketId,
          typeId: get("type") || undefined,
          uom: normalizeUom(get("uom"), "GSF") as Uom,
          low: low ?? likely * 0.82,
          likely,
          high: high ?? likely * 1.22,
          scope: normalizeScope(get("scope")),
          indexBasis,
          pricedAt,
          efficiency: num(get("efficiency")),
          gsfPerCapacity: num(get("gsfPerCapacity")),
          label: get("label"),
          provenance: this.provenanceFor(fileName, get("code"), pricedAt, sampleSize),
        });
      }
    }

    return {
      rates,
      benchmarks,
      report: {
        fileName,
        rowsRead: rows.length - 1,
        ratesMapped: rates.length,
        benchmarksMapped: benchmarks.length,
        skipped,
        missingColumns,
      },
    };
  }

  private fromJson(text: string, fileName: string, kind: ImportKind): ImportPayload {
    const skipped: ImportReport["skipped"] = [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return {
        rates: [],
        benchmarks: [],
        report: {
          fileName,
          rowsRead: 0,
          ratesMapped: 0,
          benchmarksMapped: 0,
          skipped: [{ row: 0, reason: err instanceof Error ? err.message : "invalid JSON" }],
          missingColumns: [],
        },
      };
    }

    // Accept a bare array, or an object with a rates/benchmarks/items/data key.
    const container = parsed as Record<string, unknown>;
    const list: unknown[] = Array.isArray(parsed)
      ? parsed
      : (container.rates as unknown[]) ??
        (container.benchmarks as unknown[]) ??
        (container.items as unknown[]) ??
        (container.data as unknown[]) ??
        [];

    // Reuse the CSV mapper by flattening objects to rows.
    if (!list.length) {
      return {
        rates: [],
        benchmarks: [],
        report: { fileName, rowsRead: 0, ratesMapped: 0, benchmarksMapped: 0, skipped, missingColumns: [] },
      };
    }
    const headers = Array.from(new Set(list.flatMap((o) => Object.keys(o as object))));
    const csvish = [
      headers.join(","),
      ...list.map((o) =>
        headers
          .map((h) => {
            const v = (o as Record<string, unknown>)[h];
            const s = v == null ? "" : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(","),
      ),
    ].join("\n");
    return this.fromCsv(csvish, fileName, kind);
  }

  override async conceptual(query: ConceptualQuery): Promise<ConceptualBenchmark[]> {
    return this.benchmarks.filter((b) => {
      if (query.marketId && b.marketId && b.marketId !== query.marketId) return false;
      if (query.typeId && b.typeId && b.typeId !== query.typeId) return false;
      if (query.uom && b.uom !== query.uom) return false;
      return true;
    });
  }

  override async unitCosts(query: UnitCostQuery): Promise<UnitCostLine[]> {
    const wanted = query.keys ? new Set(query.keys) : null;
    return this.rates.filter((r) => {
      if (wanted && !wanted.has(r.key)) return false;
      if (query.marketId && r.marketId && r.marketId !== query.marketId) return false;
      if (query.typeId && r.typeId && r.typeId !== query.typeId) return false;
      return true;
    });
  }
}
