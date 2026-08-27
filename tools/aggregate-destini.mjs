#!/usr/bin/env node
/**
 * Aggregate a folder of DESTINI exports into the two files BUD imports.
 *
 * A 250 MB snapshot of line-level history is not what a conceptual estimate
 * needs, and it is not what makes the tool better. What matters is the spread
 * and the sample count behind each rate — that is what drives the confidence
 * band — and a per-project summary to calibrate the market benchmarks against.
 * Both are aggregates, and both come out in the low megabytes.
 *
 * Usage:
 *   node tools/aggregate-destini.mjs <input-folder> [output-folder]
 *
 * Reads every .xlsx / .xls / .csv beneath the input folder, works out which
 * sheets hold cost lines and which hold project summaries, and writes:
 *   unit-costs.csv  — one row per cost code, with low / median / high and n
 *   benchmarks.csv  — one row per historical project
 *   report.txt      — what it read, what it skipped, and why
 *
 * Nothing is silently dropped: anything unmapped is counted and explained.
 */

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, extname, basename, relative } from "node:path";
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Column aliases. Matched loosely, because no two exports name things alike.
// ---------------------------------------------------------------------------

const ALIASES = {
  code: ["code", "costcode", "itemcode", "linecode", "assemblycode", "csicode", "account", "accountcode", "wbs"],
  description: ["description", "itemdescription", "linedescription", "name", "lineitem", "item", "activity"],
  uom: ["uom", "unit", "unitofmeasure", "units", "measure", "um"],
  unitCost: ["unitcost", "unitprice", "rate", "costperunit", "unitrate", "price", "usd"],
  quantity: ["quantity", "qty", "takeoffquantity", "tqty"],
  total: ["total", "totalcost", "amount", "extendedcost", "extended", "linetotal", "cost"],
  csi: ["csi", "csicode", "masterformat", "division", "div"],
  uniformat: ["uniformat", "uniformatcode", "element", "elementcode", "systemcode"],
  project: ["project", "projectname", "job", "jobname", "jobnumber", "projectnumber", "estimate", "estimatename"],
  market: ["market", "sector", "marketsector", "projecttype", "buildingtype"],
  buildingType: ["buildingtype", "subtype", "producttype", "type"],
  gsf: ["gsf", "grosssf", "grosssquarefeet", "area", "buildingarea", "sf", "squarefeet"],
  units: ["units", "unitcount", "keys", "beds", "capacity", "doors"],
  city: ["city", "location", "jobcity", "projectcity"],
  state: ["state", "jobstate", "projectstate"],
  date: ["date", "biddate", "estimatedate", "effectivedate", "asof", "pricingdate", "createddate"],
};

const canon = (s) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

function mapHeaders(row) {
  const map = {};
  row.forEach((cell, index) => {
    const c = canon(cell);
    if (!c) return;
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (map[field] === undefined && aliases.includes(c)) map[field] = index;
    }
  });
  return map;
}

/**
 * Find the header row. Exports routinely carry a title block, a logo row and a
 * blank line before the actual columns, so the first row is rarely it.
 */
function findHeader(rows, limit = 25) {
  let best = { index: -1, map: {}, score: 0 };
  for (let i = 0; i < Math.min(limit, rows.length); i++) {
    const map = mapHeaders(rows[i] ?? []);
    const score = Object.keys(map).length;
    if (score > best.score) best = { index: i, map, score };
  }
  return best;
}

const toNumber = (raw) => {
  if (raw == null || raw === "") return undefined;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  const cleaned = String(raw).replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
};

const toDate = (raw) => {
  if (raw == null || raw === "") return "";
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  // Excel serial dates arrive as numbers.
  if (typeof raw === "number" && raw > 20000 && raw < 60000) {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + raw * 86400000).toISOString().slice(0, 10);
  }
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "";
};

// ---------------------------------------------------------------------------

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith("~$") || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectFiles(full, out);
    else if ([".xlsx", ".xls", ".xlsm", ".csv"].includes(extname(entry).toLowerCase())) out.push(full);
  }
  return out;
}

function sheetsOf(file) {
  // CSV is parsed here rather than through the spreadsheet reader, which
  // coerces aggressively: a MasterFormat code like "03 30 00" is read as a
  // time and silently becomes the serial number 36615. Cost codes are text.
  if (extname(file).toLowerCase() === ".csv") {
    return [{ name: basename(file), rows: parseCsv(readFileSync(file, "utf8")) }];
  }
  // XLSX.readFile is absent from the ESM build; read the bytes and hand them over.
  const workbook = XLSX.read(readFileSync(file), { type: "buffer", cellDates: true });
  return workbook.SheetNames.map((name) => ({ name, rows: rowsOf(workbook.Sheets[name]) }));
}

const rowsOf = (sheet) => XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });

/** Quote-aware CSV parse. No type coercion — every cell stays a string. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => String(f).trim() !== ""));
}

// ---------------------------------------------------------------------------

/**
 * Estimate exports usually name the job in a title block above the columns
 * rather than in a column of its own — "Project:" in one cell, the name in the
 * next. Falling straight through to the filename loses that.
 */
function titleBlockValue(rows, headerIndex) {
  for (let i = 0; i < headerIndex; i++) {
    const row = rows[i] ?? [];
    for (let c = 0; c < row.length - 1; c++) {
      const label = canon(row[c]);
      if (label === "project" || label === "projectname" || label === "job" || label === "jobname" || label === "estimate") {
        const value = String(row[c + 1] ?? "").trim();
        if (value) return value;
      }
    }
  }
  return "";
}

const percentile = (sorted, p) => {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};

function main() {
  const inputDir = process.argv[2];
  const outputDir = process.argv[3] ?? "destini-aggregate";
  if (!inputDir) {
    console.error("Usage: node tools/aggregate-destini.mjs <input-folder> [output-folder]");
    process.exit(1);
  }

  const files = collectFiles(inputDir);
  const notes = [`Scanned ${files.length} files under ${inputDir}`, ""];

  /** code -> { description, uom, csi, uniformat, values: number[], projects: Set } */
  const rates = new Map();
  const projects = new Map();
  let lineRows = 0;
  let skippedSheets = 0;
  let skippedRows = 0;

  for (const file of files) {
    const label = relative(inputDir, file);
    let sheets;
    try {
      sheets = sheetsOf(file);
    } catch (err) {
      notes.push(`SKIP ${label} — could not read: ${err.message}`);
      continue;
    }

    for (const { name, rows } of sheets) {
      const { index, map, score } = findHeader(rows);
      // A sheet needs at least a code or description plus something numeric.
      const usable = score >= 3 && (map.code !== undefined || map.description !== undefined);
      if (!usable) {
        skippedSheets++;
        notes.push(`SKIP ${label} :: ${name} — no recognisable header (best match ${score} columns)`);
        continue;
      }

      const projectName =
        (map.project !== undefined
          ? String(rows.find((r, i) => i > index && r[map.project])?.[map.project] ?? "")
          : "") ||
        titleBlockValue(rows, index) ||
        basename(file, extname(file));

      let usedRows = 0;
      for (let i = index + 1; i < rows.length; i++) {
        const row = rows[i];
        const get = (field) => (map[field] === undefined ? undefined : row[map[field]]);

        const code = String(get("code") ?? "").trim();
        const description = String(get("description") ?? "").trim();
        if (!code && !description) continue;

        // Prefer a stated unit cost; fall back to total / quantity, which is
        // how most line-level exports actually carry the rate.
        let unitCost = toNumber(get("unitCost"));
        if (unitCost == null) {
          const total = toNumber(get("total"));
          const quantity = toNumber(get("quantity"));
          if (total != null && quantity) unitCost = total / quantity;
        }
        if (unitCost == null || unitCost <= 0) {
          skippedRows++;
          continue;
        }

        const key = code || description.toLowerCase();
        if (!rates.has(key)) {
          rates.set(key, {
            code: code || key,
            description: description || code,
            uom: String(get("uom") ?? "").trim(),
            csi: String(get("csi") ?? "").trim(),
            uniformat: String(get("uniformat") ?? "").trim(),
            values: [],
            projects: new Set(),
            latest: "",
          });
        }
        const entry = rates.get(key);
        entry.values.push(unitCost);
        entry.projects.add(projectName);
        const date = toDate(get("date"));
        if (date > entry.latest) entry.latest = date;
        if (!entry.uom) entry.uom = String(get("uom") ?? "").trim();
        usedRows++;
        lineRows++;

        // Project-level rollup, where the sheet carries it.
        const gsf = toNumber(get("gsf"));
        if (projectName && (gsf || map.market !== undefined)) {
          if (!projects.has(projectName)) {
            projects.set(projectName, {
              project: projectName,
              market: String(get("market") ?? "").trim(),
              buildingType: String(get("buildingType") ?? "").trim(),
              gsf: gsf ?? 0,
              units: toNumber(get("units")) ?? 0,
              city: String(get("city") ?? "").trim(),
              state: String(get("state") ?? "").trim(),
              date,
              total: 0,
            });
          }
          const p = projects.get(projectName);
          p.total += toNumber(get("total")) ?? 0;
          if (!p.gsf && gsf) p.gsf = gsf;
        }
      }

      if (usedRows > 0) notes.push(`READ ${label} :: ${name} — ${usedRows} priced lines`);
    }
  }

  mkdirSync(outputDir, { recursive: true });

  // --- unit-costs.csv ---
  const rateRows = [
    ["Cost Code", "Line Description", "Unit of Measure", "Low", "Unit Cost", "High", "Projects", "CSI", "UNIFORMAT", "Effective Date"],
  ];
  for (const entry of [...rates.values()].sort((a, b) => b.values.length - a.values.length)) {
    const sorted = [...entry.values].sort((a, b) => a - b);
    rateRows.push([
      entry.code,
      entry.description,
      entry.uom,
      round(percentile(sorted, 0.25)),
      round(percentile(sorted, 0.5)),
      round(percentile(sorted, 0.75)),
      entry.projects.size,
      entry.csi,
      entry.uniformat,
      entry.latest,
    ]);
  }
  writeFileSync(join(outputDir, "unit-costs.csv"), toCsv(rateRows));

  // --- benchmarks.csv ---
  const projectRows = [
    ["Project", "Market", "Building Type", "GSF", "Units", "Total", "Unit Cost", "Unit of Measure", "City", "State", "Effective Date"],
  ];
  // A line-level export often carries subtotal rows alongside the lines they
  // summarise. Summing everything then double counts, and the giveaway is a
  // $/GSF far outside anything a building costs. Flag those rather than
  // importing a number that would quietly poison the benchmarks.
  const IMPLAUSIBLE_PSF = 1500;
  let flagged = 0;
  for (const p of projects.values()) {
    if (!p.gsf || !p.total) continue;
    const psf = p.total / p.gsf;
    if (psf > IMPLAUSIBLE_PSF || psf < 20) {
      flagged++;
      notes.push(
        `FLAG ${p.project} — $${Math.round(psf)}/GSF is outside a believable range. ` +
          `The export probably contains subtotal rows being summed alongside their own lines; ` +
          `exclude subtotals or filter to leaf lines before re-running.`,
      );
      continue;
    }
    projectRows.push([
      p.project, p.market, p.buildingType, Math.round(p.gsf), p.units,
      Math.round(p.total), round(psf), "GSF", p.city, p.state, p.date,
    ]);
  }
  writeFileSync(join(outputDir, "benchmarks.csv"), toCsv(projectRows));

  // --- report.txt ---
  const summary = [
    "DESTINI aggregation report",
    "==========================",
    "",
    `Files scanned:      ${files.length}`,
    `Priced lines read:  ${lineRows.toLocaleString()}`,
    `Distinct rates:     ${rates.size.toLocaleString()}`,
    `Projects rolled up: ${projectRows.length - 1}`,
    `Rows without a usable rate: ${skippedRows.toLocaleString()}`,
    `Sheets with no recognisable header: ${skippedSheets}`,
    `Projects flagged as implausible and withheld: ${flagged}`,
    "",
    "Rates are reported as the 25th / 50th / 75th percentile of every observed",
    "unit cost for that code, with the number of distinct projects behind it.",
    "That spread is what drives the confidence band in the app, and it is the",
    "reason the aggregate is more useful than the raw lines.",
    "",
    "Detail",
    "------",
    ...notes,
  ].join("\n");
  writeFileSync(join(outputDir, "report.txt"), summary);

  console.log(summary.split("\nDetail")[0]);
  console.log(`Written to ${outputDir}/`);
}

const round = (n) => Math.round(n * 100) / 100;

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell == null ? "" : String(cell);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}

main();
