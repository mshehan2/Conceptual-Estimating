import { describe, expect, it } from "vitest";
import { CostResolver, escalationFactor, locationFactor } from "../resolver";
import { SeedCostSource } from "../sources/seedSource";
import { OverrideCostSource } from "../sources/overrideSource";
import { ImportedCostSource, mapHeaders, parseCsv } from "../sources/importSource";
import { DestiniApiSource } from "../sources/destiniApiSource";
import { BUILDING_TYPES } from "@/markets/registry";
import { SEED_CONCEPTUAL } from "../seed/conceptual";
import { UNIT_CATALOG } from "@/markets/unitCatalog";
import { SEED_RATE_KEYS } from "../seed/unitCosts";

const resolverWithSeed = () => new CostResolver().register(new SeedCostSource());

describe("seed library", () => {
  it("covers every building type with a $/GSF benchmark", () => {
    const covered = new Set(SEED_CONCEPTUAL.filter((b) => b.uom === "GSF").map((b) => b.typeId));
    const missing = BUILDING_TYPES.filter((t) => !covered.has(t.id)).map((t) => t.id);
    expect(missing).toEqual([]);
  });

  it("covers every unit catalog cost key with a rate", () => {
    const keys = new Set(SEED_RATE_KEYS);
    const missing = [...new Set(UNIT_CATALOG.map((u) => u.costKey))].filter((k) => !keys.has(k));
    expect(missing).toEqual([]);
  });

  it("orders every benchmark band low <= likely <= high", () => {
    for (const b of SEED_CONCEPTUAL) {
      expect(b.low).toBeLessThanOrEqual(b.likely);
      expect(b.likely).toBeLessThanOrEqual(b.high);
    }
  });

  it("resolves rates through the resolver", async () => {
    const rates = await resolverWithSeed().rates(["wall_brick", "hvac"]);
    expect(rates.get("wall_brick")?.line.likely).toBeGreaterThan(0);
    expect(rates.get("hvac")?.line.provenance.sourceKind).toBe("seed");
  });

  it("matches a site to a location index", async () => {
    const idx = await resolverWithSeed().index({ lat: 39.95, lon: -75.17 });
    expect(idx?.city).toBe("Philadelphia PA");
  });
});

describe("layering", () => {
  it("lets an override supersede the seed value and keeps the original", async () => {
    const overrides = new OverrideCostSource();
    overrides.set("wall_brick", 71.5, "SF", { note: "Locked from subcontractor quote" });

    const r = new CostResolver().register(new SeedCostSource()).register(overrides);
    const hit = (await r.rates(["wall_brick"])).get("wall_brick")!;

    expect(hit.line.likely).toBe(71.5);
    expect(hit.line.provenance.sourceKind).toBe("override");
    expect(hit.superseded).toHaveLength(1);
    expect(hit.superseded[0].provenance.sourceKind).toBe("seed");
  });

  it("ranks a live endpoint above an import above the seed", () => {
    const seed = new SeedCostSource();
    const imported = new ImportedCostSource();
    const live = new DestiniApiSource({ baseUrl: "https://example.invalid/api" });
    const overrides = new OverrideCostSource();
    expect(seed.priority).toBeLessThan(imported.priority);
    expect(imported.priority).toBeLessThan(live.priority);
    expect(live.priority).toBeLessThan(overrides.priority);
  });

  it("reports an unconfigured live source instead of throwing", () => {
    const live = new DestiniApiSource({ baseUrl: "" });
    expect(live.status().state).toBe("unconfigured");
    expect(live.isConfigured()).toBe(false);
  });
});

describe("DESTINI export import", () => {
  it("parses quoted CSV including embedded commas and newlines", () => {
    const rows = parseCsv('a,b\n"x,1","line\nbreak"\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x,1", "line\nbreak"],
    ]);
  });

  it("matches headers by alias regardless of naming", () => {
    const cols = mapHeaders(["Cost Code", "Line Description", "Unit of Measure", "Unit Cost"]);
    expect(cols.code).toBe(0);
    expect(cols.label).toBe(1);
    expect(cols.uom).toBe(2);
    expect(cols.value).toBe(3);
  });

  it("ingests a rate export and serves it above the seed", async () => {
    const csv = [
      "Cost Code,Line Description,Unit of Measure,Unit Cost,Projects",
      'wall_brick,"Brick veneer, imported",SF,"$68.25",9',
      "hvac,HVAC systems,GSF,34.10,9",
    ].join("\n");

    const imported = new ImportedCostSource();
    const report = imported.ingest(csv, "destini-rates.csv", "rates");
    expect(report.ratesMapped).toBe(2);
    expect(report.skipped).toEqual([]);

    const r = new CostResolver().register(new SeedCostSource()).register(imported);
    const hit = (await r.rates(["wall_brick"])).get("wall_brick")!;
    expect(hit.line.likely).toBe(68.25);
    expect(hit.line.provenance.sourceKind).toBe("import");
    expect(hit.line.provenance.confidence).toBe("high");
  });

  it("reports unmappable rows rather than dropping them", () => {
    const csv = ["Cost Code,Description,UOM,Unit Cost", "wall_brick,Brick,SF,55", ",Orphan line,SF,12"].join("\n");
    const imported = new ImportedCostSource();
    const report = imported.ingest(csv, "partial.csv", "rates");
    expect(report.ratesMapped).toBe(1);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0].row).toBe(3);
  });

  it("accepts a JSON export as readily as CSV", () => {
    const json = JSON.stringify({
      rates: [{ code: "hvac", description: "HVAC", unitOfMeasure: "GSF", value: 31 }],
    });
    const imported = new ImportedCostSource();
    expect(imported.ingest(json, "export.json", "rates").ratesMapped).toBe(1);
  });
});

describe("indexing and escalation", () => {
  it("compounds escalation over whole years", () => {
    expect(escalationFactor("2026-01-01", "2027-01-01", 4)).toBeCloseTo(1.04, 3);
    expect(escalationFactor("2026-01-01", "2028-01-01", 4)).toBeCloseTo(1.0816, 3);
  });

  it("never escalates backwards or without a midpoint", () => {
    expect(escalationFactor("2026-01-01", "2025-01-01", 4)).toBe(1);
    expect(escalationFactor("2026-01-01", undefined, 4)).toBe(1);
  });

  it("scales a rate from its stated basis to the target index", () => {
    expect(locationFactor(100, 115)).toBeCloseTo(1.15, 5);
    expect(locationFactor(115, 115)).toBe(1);
  });
});
