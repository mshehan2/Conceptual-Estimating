# BUD // Session handoff

**Written 2026-08-28. Branch `claude/project-iteration-market-type-qsp3tw`, clean and pushed at the time of writing. 341 tests pass, build clean.**

Owner: Matt Shehan, VP Preconstruction, Benchmark Construction (mshehan@benchmarkgc.com).

---

## 1. What this is

BUD is a conceptual estimating and massing studio. A parametric building model
drives a bottom-up estimate, and the render and the number come from the same
geometry, so they cannot drift apart. It started as a single-file React and
three.js prototype (`BUD_1.html`, the original upload) and is now a Vite +
React 18 + TypeScript app.

The current direction, decided with Matt on 8/27, is to fold Benchmark's real
conceptual estimating method and its DESTINI cost history into it. **The full
plan is a published artifact and you should read it before touching anything:**

> https://claude.ai/code/artifact/6bade130-e3a8-4f4c-a56b-91b151acf0f0

Everything below is the part that does not fit in the plan.

---

## 2. Read this first, in this order

1. The plan artifact above.
2. `docs/destini-data.md`, the real snapshot schema and the rules the
   extractor enforces. Rewritten 8/28; the version before that was wrong.
3. `docs/cost-data.md`, how the layered cost sources work.
4. `src/costs/schema.ts`, the `Quoted<T>` / provenance idea that everything
   priced runs through.

---

## 3. The four decisions Matt made on 8/27

These are settled. Do not relitigate them.

1. **The shell engine replaces the Core & Shell tab.** Historical comps check
   the result and stay in the library as comps. They no longer drive it.
2. **DESTINI reaches the app as a pre-aggregated extract**, never as the raw
   540 MB snapshot. `tools/destini-extract.py` does this.
3. **Driver chains get built for MOB, bed tower and research**, so the UPC 1,
   Original Hospital and Crescent models share machinery.
4. **Office & Conference sits above $100 and below $200.** See section 6.

---

## 4. State of the code

Everything below is committed and pushed. Working tree was clean.

**Working and tested**
- Polygon-first footprints. L/U/T/courtyard are presets that *generate* a
  polygon; a hand-drawn plan is not a special case.
- Plan editor (draw and drag the footprint) and feature editor (16 architectural
  features, each emitting geometry AND quantities from the same parameters).
- Progressive accumulation renderer, conditioning passes (depth, linework,
  material mask) for the AI photoreal step.
- Layered `CostSource` / `CostResolver` with priority: Override 100 > DESTINI
  live 70 > Import 50 > Seed 10.
- Entourage placed the way a site plan places it: cars in real 9x18 stalls in
  double-loaded bays, trees on islands and property lines, people between the
  parking and the door.

**Known-good test harnesses** (they have each caught real shipped defects)
- `npx vitest run`, 341 tests.
- `node tools/feature-check.mjs <out>` drives the feature editor in a real
  browser and counts pixels per feature. Needs `npm run preview` running and
  `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Slow
  (10+ min). Its threshold is *measured*, not guessed: it adds a feature,
  deletes it, and calls whatever moved the noise floor.
- `node tools/feature-render.mjs <out>` produces hero renders with all features on.

**Deliberately not done**
- No live call has ever been made to any image provider. The Flux adapter is
  written against the published FLUX.2 shape and is **unexercised**; this
  sandbox blocks `api.bfl.ai` and `docs.bfl.ai` entirely. First real call is
  the first test. If it 422s, check the field names in `buildBody`.
- CORS from a browser to BFL is unverified. The proxy URL field exists for this.

---

## 5. What to build next, in dependency order

Phases 1 through 4 are **not blocked**. Phase 5 is gated on Matt running the
extract.

1. **Correct the money math.** Two real defects, both quantified against UPC 1:
   - Markups are flat (`direct * pct`) in `src/domain/estimate.ts` around line
     216. Benchmark's cascade **compounds on the running subtotal**. On UPC 1
     flat gives $10,853,997 against a compounded $11,960,110, so the tool
     understates indirects by **$1.1M, 10.2%**. Compounding and then escalating
     reproduces $64,252,350 against the stated $64,135,000, a 0.18% gap that is
     row rounding. Use that as the acceptance test.
   - Escalation is a flat percent per year. It must be the Cost Index table
     (2008-2027, in the snapshot as `CostIndex.csv`). 2022 to 2026 on the index
     is 129.5106 to 141.6871, about 2.3%/yr, not the 3% default.
   - The cascade belongs to the **scheme**, not the app. The 8/21 owner
     direction cut GC Personnel to 5% and Design Contingency to 0% on Hospital
     and Crescent; UPC 1 never received it. Three models, three rulesets.
2. **Load the comp library as a cost source.** 82 comps in `comps v7.json`.
   Modality tags map to fitout categories. Every rate arrives with its comps,
   sample count, spread and confidence.
3. **Model the driver chain.** General form is
   `DGSF = Σ(count × DGSF per unit)`, with net area carried directly when no
   KPU applies. See section 7: a single blended DGSF/KPU will not generalize.
4. **Split the division schedule between the engines.** Shell divisions from
   massing quantities, fitout divisions from modality area × comp rate, with a
   hard assertion that no division draws from both.
5. **Rewrite the import path** to consume `unit-rates.csv`. Gated on the extract.
6. **Write back to the Historical Estimate Template.** Last, deliberately.

---

## 6. Findings worth not rediscovering

**The office rate is inconsistent across the three models.** SHIP Bldg 8, PSU
Great Valley and Beltway Commons drive the office tab on all three: UPC 1 at
$203.39, Hospital at $100.69, Crescent at $130.00. Identical evidence, three
answers spanning two to one, **$17,043,168 of direct cost across 165,951 SF of
campus office area decided by which workbook you are in.** This is the clearest
argument for the modality engine and it is not really about office.

**Ground-up comps cannot drive a fitout tab** that sits next to a Core & Shell
seed; they carry their own MEP and double count. Matt's rule, from the 8/21
Crescent round. Applying it, the admissible office fitout cluster is $77 to $94
(CARONOFF 77, BELTWAY 78, SUDEGEN 81, SHIP8 94), and ENBHQ (199) and FMBROWN
(140) are excluded. Crescent's $130 is a deliberate uplift above that cluster.
**An earlier read of mine that took a median of all office-tagged comps and got
$140 was wrong for exactly this reason.**

**Geometry alone does not explain shell cost.** I tested the obvious claim, that
normalizing shell comps by wall area instead of floor area would collapse the
spread. It failed: CV 0.44 to 0.40, essentially unchanged. The variance is
*material*, not geometry (MOOVE_CS metal panel about $60/SF of wall, CHSEL_CS
about $247). So the defensible claim is narrower: **shell cost is Σ(quantity ×
rate by assembly)**, geometry supplying the quantity and material selection
supplying the rate. Do not oversell this.

**Seeds are the norm, not the exception, and sample size is not why.** Crescent
has six of eight tabs seeded. Matt's reason: *"the comp totals match; the
composition does not."* Wet Lab, three of four comps bought casework and fume
hoods outside the contract. Lab Support, zero Div 11 across all four because
nobody bought glasswashers in contract. A blended $/SF cannot see that. A
division-level engine can, and **should say it out loud** rather than leaving
Matt to notice. This is a capability to build, not just a caveat.

**The blended DGSF/KPU decomposes.** Flad's 540 is 229 SF of actual room
(112 exam at 208, 6 procedure at 500, 2 x-ray at 600) plus 311 SF of everything
supporting it. At Jamie Matthys's 700, only a third of departmental area is
room. That turns an unwinnable contest between two blended benchmarks into an
argument about support ratio.

**Flad's comps are Total Project Cost**, GCs and indirects included, RS Means
normalized to Allentown 2026. The comparable line is Project Cost per GSF, not
Building and Site. Matt already caught Jamie reading $450 against $600 on 8/14.
The tool should make that mismatch impossible rather than catchable.

**Crescent is the case that justifies the shell engine**, not UPC 1. Its C&S
seed is $349 against a $542 comp average, with a declared sensitivity of
$320/$349/$400 giving -$13.9M/base/+$24.4M. A $38M swing on one slider.

---

## 7. Traps

- **A single blended DGSF/KPU will not generalize.** The Hospital is two rates
  summed (11 OR at 4,200 *plus* 256 beds at 800, and the bed side is a
  catch-all). Crescent has no KPU at all: 165,200 net SF carried forward times
  an NSF:GSF ratio of 2.25. Build the general form or you will rewrite it.
- **Label whose assumption a number is.** Flad fixed the Hospital's KPU counts
  and gross factor. The eleven block percentages are Benchmark's, and Matt's own
  README calls them the most attackable numbers in the model. Provenance needs
  client-fixed versus Benchmark-assumed, not just source and date.
- **`TotalCostPerUnit` is poison.** Never map it. Unit cost is
  `TotalCost / Quantity`.
- **Symmetric plans hide geometry bugs.** The roof was built mirrored in Z for
  the entire life of the project and every test passed, because mirroring a
  rectangle or a centred courtyard is invisible. Any new geometry test must
  include an asymmetric plan. `src/render/__tests__/massGeometry.test.ts` says
  so in a test, deliberately, so nobody removes the L and U cases as redundant.
- **Priced-but-not-drawn is this project's signature defect.** It has shipped
  three times: material banding, the loggia recess buried behind an intact wall,
  and the roof terrace and atrium skylight floating over the notch of an L.
  Anything that emits both a quantity and a mesh needs a test that they agree.
- **Never use em dashes** in anything Benchmark-facing. It is a house rule from
  the UPC 1 README section 7, along with yellow FFFF00 for manual inputs and
  Benchmark navy 003057 / orange FA4616.
- **openpyxl mangles shared-formula groups** on re-save of untouched sheets.
  If you ever write the Historical Estimate Template, freeze legacy hidden tab
  formulas to values on load, then scan every `xl/worksheets/*.xml` for
  `<f t="shared"` without a `ref`. That count must be zero.

---

## 8. What is NOT in this repo, and why

Matt's source material was attached to the session, not committed:

- `UPC1-MOB-Budget-Handoff.zip`, the UPC 1 model, comp library v7 (82 comps),
  the `conceptual-estimate` and `ask-destini-v2` skills, `upc1-budget.json`.
- `Hospital-Crescent-Delta-Package.zip`, Hospital v1.35 and Crescent v1.3
  workbooks and JSON extracts, `new-comps-crescent.json`.

**I deliberately did not commit these.** They are Benchmark's client cost data
for Penn State Health, and a git history is permanent. Matt owns that call, not
me. Ask him to re-attach them, or ask whether he wants them in the repo.

The DESTINI snapshot itself lives in Egnyte at
`/Shared/Precon/06-DESTINI Estimator Info/DESTINI Snapshot` (540 MB, 4 CSVs,
dated 2026-07-10). It **cannot** be pulled through the Egnyte MCP: at 256 MB the
cost file is refused as non-extractable text. Do not create a public share link
for it. Matt runs the extractor locally and sends the three small files back.

---

## 9. Open, waiting on Matt

1. **Run the extract.** He has `tools/destini-extract.py` and
   `Extract DESTINI for BUD.bat`. The number that matters in `coverage.json` is
   `quantity_coverage_pct`. It decides whether the shell engine gets real
   Benchmark unit rates or seed rates labelled as such.
2. **Flux API key.** He has one. It goes in the app's Photoreal panel
   (localStorage), never in the repo and never pasted into chat.
3. **Whether the client cost data goes in the repo** (section 8).
4. **Design Contingency at 0%** on Hospital and Crescent is, in Matt's own
   words, the likely pushback point on a concept estimate with no drawings.
5. **Renew.** Crescent's is priced at $130M and well specified (interior rate by
   modality on the existing mix, plus building-wide renewal layers on full BGSF,
   plus an 8% occupied-building premium). Hospital and UPC 1 Renew are empty.
   It is a third engine shape and should be its own conversation.

---

## 10. How Matt works

He is a precon VP. Show him decisions, not homework. Alerts beat guesses. He
will tell you plainly when a number is wrong, and he is usually right about
which direction. When he pushes back on something, it is worth checking the
data before defending the position: twice in this session his instinct beat my
analysis, and once my analysis was wrong in a way only his domain knowledge
caught.
