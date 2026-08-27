#!/usr/bin/env python3
"""
Turn the DESTINI snapshot into the three small files BUD imports.

The snapshot is ~540 MB and none of it belongs in a web app. What the app
needs is aggregates: a unit rate per assembly with its spread and sample
count, a per-project rollup to calibrate benchmarks against, and an honest
account of what was dropped on the way. All three come out in the low
megabytes.

This applies Benchmark's own rules rather than inventing its own:
  - unit cost is TotalCost / Quantity. The TotalCostPerUnit field is never
    read, so it cannot be used by accident.
  - direct cost is TotalCost - DistributedFeeAmount.
  - Div 01 keeps Masterformat L1 GENERAL REQUIREMENTS and 00 PROCUREMENT.
    GENERAL CONDITIONS, PRECONSTRUCTION, FEES and DESIGN FEES are stripped
    because the markup cascade already carries them.
  - 00 folds to 01. 25, 27 and 28 fold to 26. 31 through 34 are dropped:
    site belongs in Summary allowances.
  - Div 09 splits three ways off Masterformat L2.

Usage:
  python tools/destini-extract.py --snapshot "<DESTINI Snapshot folder>" \
      [--out ./destini-extract] [--min-samples 8]

Requires: pip install duckdb
"""

import argparse
import glob
import json
import os
import sys

try:
    import duckdb
except ImportError:
    sys.exit("pip install duckdb")


# --- Benchmark folding rules -------------------------------------------------

FOLD = {"00": "01", "25": "26", "27": "26", "28": "26"}
SITE_DIVS = ("31", "32", "33", "34")
DIV01_KEEP = ("GENERAL REQUIREMENTS", "PROCUREMENT")

# Divisions the geometry engine prices. Unit rates here are the payload.
SHELL_DIVS = ("03", "04", "05", "07", "08")


def find(folder, needle):
    hits = [
        p for p in glob.glob(os.path.join(folder, "*.csv"))
        if needle.lower() in os.path.basename(p).lower()
    ]
    if not hits:
        sys.exit(f"no CSV matching '{needle}' in {folder}")
    return max(hits, key=os.path.getsize)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", required=True)
    ap.add_argument("--out", default="./destini-extract")
    ap.add_argument("--min-samples", type=int, default=8,
                    help="drop assemblies thinner than this; they cannot carry a spread")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    print("reading the snapshot. The cost file is large, so give this a minute.")
    con = duckdb.connect()

    for view, needle in (("cl", "HistoricalCostData"),
                         ("est", "EstimateSummary"),
                         ("prop", "EstimatePropertyData")):
        # Forward slashes and doubled quotes: a Windows path goes into a SQL
        # string literal here, and C:\Users\... with an apostrophe in it is a
        # perfectly normal thing for a folder to be called.
        path = find(args.snapshot, needle).replace("\\", "/").replace("'", "''")
        con.execute(
            f"CREATE VIEW {view} AS SELECT * FROM "
            f"read_csv_auto('{path}', header=true, sample_size=-1, all_varchar=false)"
        )

    # Estimate-level area, the way the ask-destini schema defines it: derived
    # $/SF first, the entered property second. Never invented.
    con.execute("""
        CREATE VIEW est_area AS
        SELECT
          upper(e.EstimateKey)                        AS ek,
          any_value(e.EstimateName)                   AS name,
          any_value(e.EstimateNumber)                 AS job,
          max(e.CreateYear)                           AS year,
          any_value(e.ClientCity)                     AS city,
          any_value(e.ClientState)                    AS state,
          max(e.DirectCost)                           AS direct_cost,
          COALESCE(
            NULLIF(round(max(e.TotalCost) / NULLIF(max(e.TotalCostPerArea), 0)), 0),
            NULLIF(max(p.area), 0)
          )                                           AS area_sf,
          CASE
            WHEN max(e.TotalCostPerArea) > 0 THEN 'Derived'
            WHEN max(p.area) > 0            THEN 'Property'
            ELSE 'Missing'
          END                                         AS area_source
        FROM est e
        LEFT JOIN (
          SELECT upper(EstimateKey) AS ek, max(TRY_CAST("Value" AS DOUBLE)) AS area
          FROM prop WHERE lower(Property) LIKE '%total building area%' GROUP BY 1
        ) p ON p.ek = upper(e.EstimateKey)
        GROUP BY 1
    """)

    # Cost lines, folded. Direct cost only: fee comes off every line.
    con.execute(f"""
        CREATE VIEW lines AS
        SELECT
          upper(c.EstimateKey)                              AS ek,
          substr(trim(c.Masterformat_L1), 1, 2)             AS div_raw,
          trim(c.Masterformat_L1)                           AS mf1,
          trim(c.Masterformat_L2)                           AS mf2,
          upper(trim(c.Unit))                               AS unit,
          TRY_CAST(c.Quantity AS DOUBLE)                    AS qty,
          TRY_CAST(c.TotalCost AS DOUBLE)
            - COALESCE(TRY_CAST(c.DistributedFeeAmount AS DOUBLE), 0) AS direct
        FROM cl c
        WHERE c.Masterformat_L1 IS NOT NULL
    """)

    keep01 = " OR ".join(f"upper(mf1) LIKE '%{k}%'" for k in DIV01_KEEP)
    con.execute(f"""
        CREATE VIEW folded AS
        SELECT
          CASE div_raw {' '.join(f"WHEN '{a}' THEN '{b}'" for a, b in FOLD.items())}
               ELSE div_raw END                             AS div,
          div_raw, mf1, mf2, unit, qty, direct,
          CASE
            WHEN substr(mf2, 1, 4) IN ('09 3', '09 6') THEN '9fl'
            WHEN substr(mf2, 1, 4) = '09 9'            THEN '9pt'
            WHEN div_raw = '09'                        THEN '9dw'
            ELSE NULL END                               AS div09,
          ek
        FROM lines
        WHERE div_raw NOT IN {SITE_DIVS}
          AND (div_raw NOT IN ('00', '01') OR ({keep01}))
    """)

    # --- 1. unit rates by assembly ------------------------------------------
    rates = con.execute(f"""
        SELECT
          f.div                                            AS division,
          f.mf2                                            AS assembly,
          f.unit                                           AS uom,
          count(*)                                         AS n,
          count(DISTINCT f.ek)                             AS n_jobs,
          round(median(f.direct / f.qty), 2)               AS median_rate,
          round(quantile_cont(f.direct / f.qty, 0.25), 2)  AS p25,
          round(quantile_cont(f.direct / f.qty, 0.75), 2)  AS p75,
          min(e.year)                                      AS first_year,
          max(e.year)                                      AS last_year,
          round(sum(f.direct))                             AS total_direct
        FROM folded f
        JOIN est_area e ON e.ek = f.ek
        WHERE f.qty > 0 AND f.direct > 0 AND f.unit IS NOT NULL AND f.unit <> ''
          AND f.div IN {SHELL_DIVS + ('06', '09', '10', '21', '22', '23', '26')}
        GROUP BY 1, 2, 3
        HAVING count(*) >= {args.min_samples}
        ORDER BY 1, 2, 3
    """).fetchall()

    write_csv(os.path.join(args.out, "unit-rates.csv"),
              ["division", "assembly", "uom", "n", "n_jobs", "median_rate",
               "p25", "p75", "first_year", "last_year", "total_direct"], rates)

    # --- 2. per-project rollup ----------------------------------------------
    roll = con.execute("""
        SELECT
          e.ek, e.name, e.job, e.year, e.city, e.state,
          e.area_sf, e.area_source,
          COALESCE(f.div09, f.div)      AS division,
          round(sum(f.direct))          AS direct
        FROM est_area e
        JOIN folded f ON f.ek = e.ek
        WHERE e.area_sf > 0
        GROUP BY 1,2,3,4,5,6,7,8,9
        HAVING sum(f.direct) <> 0
        ORDER BY e.year DESC, e.name, division
    """).fetchall()

    write_csv(os.path.join(args.out, "project-divisions.csv"),
              ["estimate_key", "name", "job", "year", "city", "state",
               "area_sf", "area_source", "division", "direct"], roll)

    # --- 3. coverage: what got dropped, and why -----------------------------
    def scalar(sql):
        return con.execute(sql).fetchone()[0]

    total_lines = scalar("SELECT count(*) FROM lines")
    cov = {
        "snapshot": os.path.abspath(args.snapshot),
        "estimates": scalar("SELECT count(*) FROM est_area"),
        "estimates_with_area": scalar("SELECT count(*) FROM est_area WHERE area_sf > 0"),
        "area_source": dict(con.execute(
            "SELECT area_source, count(*) FROM est_area GROUP BY 1").fetchall()),
        "cost_lines": total_lines,
        "lines_after_folding": scalar("SELECT count(*) FROM folded"),
        "lines_dropped_site_31_34": scalar(
            f"SELECT count(*) FROM lines WHERE div_raw IN {SITE_DIVS}"),
        "lines_dropped_gc_precon_fee": scalar(
            f"SELECT count(*) FROM lines WHERE div_raw IN ('00','01') AND NOT ({keep01})"),
        "lines_with_quantity": scalar(
            "SELECT count(*) FROM folded WHERE qty > 0 AND unit IS NOT NULL AND unit <> ''"),
        "assemblies_published": len(rates),
        "quantity_coverage_by_division": {
            str(d): {"lines": n, "with_qty": q, "pct": round(100.0 * q / n, 1) if n else 0.0}
            for d, n, q in con.execute("""
                SELECT div, count(*),
                       sum(CASE WHEN qty > 0 AND unit IS NOT NULL AND unit <> '' THEN 1 ELSE 0 END)
                FROM folded GROUP BY 1 ORDER BY 1
            """).fetchall()
        },
    }
    cov["quantity_coverage_pct"] = round(
        100.0 * cov["lines_with_quantity"] / max(1, cov["lines_after_folding"]), 1)

    with open(os.path.join(args.out, "coverage.json"), "w") as fh:
        json.dump(cov, fh, indent=2)

    # --- report --------------------------------------------------------------
    print(f"estimates              {cov['estimates']:>9,}  "
          f"({cov['estimates_with_area']:,} with an area)")
    print(f"cost lines             {cov['cost_lines']:>9,}")
    print(f"  after folding        {cov['lines_after_folding']:>9,}")
    print(f"  dropped site 31-34   {cov['lines_dropped_site_31_34']:>9,}")
    print(f"  dropped GC/precon/fee{cov['lines_dropped_gc_precon_fee']:>9,}")
    print(f"  with usable quantity {cov['lines_with_quantity']:>9,}  "
          f"({cov['quantity_coverage_pct']}%)")
    print(f"assemblies published   {cov['assemblies_published']:>9,}  "
          f"(min {args.min_samples} samples)")
    print(f"\nwritten to {os.path.abspath(args.out)}")
    if cov["quantity_coverage_pct"] < 25:
        print("\nQUANTITY COVERAGE IS THIN. The shell engine falls back to the seed\n"
              "library calibrated against the core-shell comps, and every shell line\n"
              "gets labelled as such rather than claiming a Benchmark rate.")


def write_csv(path, header, rows):
    import csv
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)


if __name__ == "__main__":
    main()
