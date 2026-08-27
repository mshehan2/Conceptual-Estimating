# Cost data architecture

## The short version

Nothing in the app reads a cost number directly. The estimating engine asks a
**resolver**; the resolver asks whatever **sources** are registered and returns
the winning value bound to its **provenance**. Adding a live DESTINI endpoint is
registering one more source — no call site changes.

```
                        ┌──────────────────────┐
  estimating engine ──▶ │    CostResolver      │
  program / takeoff     │  layered by priority │
                        └──────────┬───────────┘
                                   │
        ┌──────────────┬───────────┼────────────┬──────────────┐
        ▼              ▼           ▼            ▼              ▼
  OverrideSource  DestiniApi   Imported     SeedSource    (your next
     (100)          (70)      Export (50)      (10)         source)
```

Highest priority that can answer a question wins it. Everything it beat is kept
and reported as `superseded`, so the UI can show what the number would have been
under a different source.

## Every value carries provenance

```ts
interface Provenance {
  sourceId: string;         // "seed" | "destini" | "import" | "override"
  sourceLabel: string;      // shown on the chip
  sourceKind: SourceKind;
  externalId?: string;      // the DESTINI line id, when there is one
  asOf?: string;            // what date the data is current as of
  basis?: string;           // "12 projects, mid-Atlantic, 2023-2025"
  confidence: Confidence;   // high | medium | low | placeholder
  sampleSize?: number;
  derived?: boolean;
}
```

This is what makes the seed library safe to ship. Seed rows are marked
`confidence: "low"` with a basis note saying explicitly that they are not
DESTINI data. Nobody can mistake a placeholder for a sourced number.

## The two kinds of data

**Conceptual benchmarks** — whole-building rates addressed by market and
building type. `$/GSF` plus a capacity rate (`$/unit`, `$/key`, `$/bed`,
`$/stall`) where one makes sense, each as a low/likely/high band rather than a
false point value. Carries `efficiency` and `gsfPerCapacity` so a target
capacity can be turned into a building.

**Unit costs** — the granular assembly rates the bottom-up takeoff multiplies
quantities by, keyed by BUD's stable internal rate key (`wall_brick`,
`elevated_floor`, `fitout_or`). CSI and UNIFORMAT codes ride along so an
imported line can be matched by code when its key doesn't map directly.

Keeping the internal key separate from any source's own coding is the thing
that lets a seed value, a DESTINI import, and a hand override all answer the
same question interchangeably.

## Going live with DESTINI

`DestiniApiSource` is written, not stubbed. It fetches, maps, caches, reports
status, and refreshes. What it lacks is a URL and a credential.

1. **Configure** — set the endpoint in the cost-data panel, or via
   `VITE_DESTINI_BASE_URL`, `VITE_DESTINI_TOKEN`, `VITE_DESTINI_DATASET`.
2. **Map, if needed** — if your JSON differs from `WireBenchmark` / `WireRate`,
   edit `mapBenchmark` / `mapRate` in `src/costs/sources/destiniApiSource.ts`.
   Those two functions are the entire contract surface.
3. **Register** — `resolver.register(new DestiniApiSource(config))`. It
   outranks the seed library automatically.

Expected endpoints:

| Path | Returns |
|---|---|
| `GET /conceptual-benchmarks` | `WireBenchmark[]` |
| `GET /unit-costs` | `WireRate[]` |
| `GET /indices?city=…` | `WireIndex` |

**CORS:** the browser calls this directly, so the endpoint must allow the app's
origin. If it can't, put a thin proxy in front and point `baseUrl` at the proxy
— the adapter can't tell the difference.

## Until then: file import

`ImportedCostSource` ingests a DESTINI Estimator/Profiler export as CSV or JSON
today, with no endpoint at all. Headers are matched by alias (`Cost Code`,
`Line Description`, `Unit of Measure`, `Unit Cost`, and dozens of variants), so
it tolerates template drift. Anything it can't map is **reported, never silently
dropped** — `ImportReport.skipped` names the row and the reason.

## What the seed library covers

- 42 building types across 9 markets, each with a `$/GSF` band and, where
  meaningful, a capacity band
- 77 assembly rate keys spanning substructure through sitework, plus a
  per-space-type fit-out premium for all 77 catalog space types
- 68 ENR-style city location indices with haversine nearest-metro matching

All of it stated at index 100, priced `2026-01-01`, and marked low confidence.
It is scaffolding that produces defensible orders of magnitude — it is not a
substitute for your own historical data, and it is built to be replaced.
