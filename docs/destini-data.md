# Getting your DESTINI data in

## Short version

Don't send the 250 MB snapshot. Put the export folder somewhere I can reach it
(Egnyte, SharePoint, or Drive), or run the aggregator yourself:

```bash
node tools/aggregate-destini.mjs /path/to/destini-exports ./destini-aggregate
```

That produces three files, totalling a few megabytes:

| File | What it is |
|---|---|
| `unit-costs.csv` | One row per cost code — low / median / high and the number of projects behind it |
| `benchmarks.csv` | One row per historical project — market, type, GSF, capacity, total, $/GSF |
| `report.txt` | What was read, what was skipped, and what was flagged |

Then drop `unit-costs.csv` into **Cost data → Import a DESTINI export** and it
outranks the seed library immediately.

## Why aggregate rather than send everything

The tool does not need line-level history, and line-level history would just get
aggregated on the way in. What it needs is the **spread** and the **sample
count**: the 25th/50th/75th percentile of every observed unit cost for a code,
and how many distinct projects stand behind it. That spread drives the
confidence band the estimate shows, and the sample count drives whether a rate
is marked high, medium or low confidence.

So the aggregate is not a compromise — it is better input than the raw lines.

## What the aggregator handles

- Nested folders of `.xlsx`, `.xlsm`, `.xls`, and `.csv`
- Title blocks, logo rows, and blank lines above the real header — it finds the
  header row rather than assuming row one
- Column names it has never seen, matched by alias: `Cost Code`, `Account Code`,
  `Item Code`, `Line Description`, `Unit of Measure`, `UM`, `Unit Cost`, `Rate`,
  `Extended Cost`, and a few dozen more
- A missing unit cost, derived from `Extended Cost / Quantity`, which is how
  most line-level exports actually carry the rate
- Project names taken from a `Project:` title-block cell, falling back to the
  filename

## What it refuses to do quietly

- **Cost codes stay text.** A spreadsheet reader will happily turn the
  MasterFormat code `03 30 00` into the serial number `36615`, because it looks
  like a time. CSVs are parsed without type coercion for exactly this reason.
- **Unmappable rows are counted and explained** in `report.txt`, never dropped
  in silence.
- **Implausible project totals are withheld.** If a project comes out above
  $1,500/GSF or below $20/GSF, the export almost certainly contains subtotal
  rows being summed alongside the lines they summarise. Those are flagged with
  the reason rather than imported, because a double-counted total would quietly
  poison the market benchmarks it is meant to calibrate.

If you see flags, filter the export to leaf lines — no subtotals, no group
headers — and run it again.

## If you'd rather I did it

Point me at the folder in Egnyte, SharePoint, or Drive. I'll pull it, run the
aggregation here, look at the report, and tell you what the data actually says —
including which of the seed library's placeholder rates your history contradicts.
