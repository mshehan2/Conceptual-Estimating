# Getting your DESTINI data in

## Short version

Don't send the 540 MB snapshot. Run the extractor against it and send the three
small files that come out.

**Windows, the easy way.** Put `tools/destini-extract.py` and
`tools/Extract DESTINI for BUD.bat` in the same folder and double-click the
`.bat`. It finds the snapshot, checks Python, installs `duckdb` if missing, and
writes a `destini-extract` folder beside itself.

**Anywhere, by hand:**

```bash
pip install duckdb
python tools/destini-extract.py --snapshot "…/DESTINI Snapshot" --out ./destini-extract
```

| File | What it is |
|---|---|
| `unit-rates.csv` | One row per assembly (Masterformat L2 × unit): median, p25, p75, line count, job count, year range |
| `project-divisions.csv` | One row per estimate × division: area, direct cost, area source |
| `coverage.json` | What was read, what was dropped and why, and quantity coverage per division |

## Why aggregate rather than send everything

The app does not need line-level history and would only aggregate it on the way
in. What it needs is the **spread** and the **sample count** behind each rate,
because those drive the confidence band. The aggregate is better input than the
raw lines, not a compromise.

## What the snapshot actually is

Four CSVs exported from the DESTINI cost-history Power BI model, joined on
`EstimateKey` (uppercase both sides; GUID casing is inconsistent in the export).

| Table | Rows, roughly | Carries |
|---|---|---|
| `EstimateSummaryDataDetails` | 1,762 estimates | name, number, year, client city/state, TotalCost, DirectCost, TotalCostPerArea |
| `HistoricalCostData` | 258,000 cost lines | Quantity, Unit, TotalCost, DistributedFeeAmount, Masterformat_L1/L2, Benchmark_L1/L2 |
| `EstimatePropertyDataDetails` | 45,000 rows | long-format properties; "Total Building Area" is the one that matters |
| `CostIndex` | 21 rows | Year → Factor, 2008 through 2027. This is the escalation basis |

### Rules the extractor enforces

These are Benchmark's, learned the hard way, and each one is in the code rather
than in a comment:

- **Unit cost is `TotalCost / Quantity`.** The `TotalCostPerUnit` field is never
  mapped into the schema at all, so it cannot be read by accident. It reads at a
  fraction of computed and does not tie.
- **Direct cost nets off `DistributedFeeAmount`** on every line.
- **Div 01** keeps Masterformat L1 `GENERAL REQUIREMENTS` and `00 PROCUREMENT`.
  `GENERAL CONDITIONS`, `PRECONSTRUCTION`, `FEES` and `DESIGN FEES` are stripped,
  because the markup cascade already carries them and keeping both double counts.
- **00 folds to 01. 25, 27 and 28 fold to 26. 31 through 34 are dropped** as
  site, which belongs in Summary allowances.
- **Div 09 splits three ways** off Masterformat L2: `09 3x`/`09 6x` to flooring,
  `09 9x` to paint, everything else to drywall and ceilings.
- **Area is derived, never invented.** `TotalCost / TotalCostPerArea` first, the
  entered "Total Building Area" property second, and `area_source` records which.

### The number to look at first

`coverage.json` reports `quantity_coverage_pct` overall and per division. It is
the gate on the whole shell-engine plan: assemblies can only carry a Benchmark
unit rate where the lines carry a usable quantity and unit. If coverage is thin
the extractor says so in its closing line, and the shell engine falls back to
seed rates calibrated against the core-shell comps, labelled as such on every
line rather than quietly claiming a Benchmark rate.

## Deprecated

`tools/aggregate-destini.mjs` predates anyone here seeing the real snapshot. It
assumes a single flat table, will not match `Masterformat_L1`/`_L2`, knows
nothing about `DistributedFeeAmount` or the folding rules, and avoids the
poisoned `TotalCostPerUnit` field by luck rather than by rule. Use
`tools/destini-extract.py`. The old file is kept only until the import path in
the Cost data panel is repointed.
