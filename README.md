# BUD — Conceptual Estimating

Iterate a project by **market**, then by **building type**, against cost data
fed by DESTINI, and get a rendering worth showing someone.

Successor to the single-file `BUD_1.html` massing studio. The single-file
delivery format is preserved as a build target rather than an architectural
constraint — see [Why it isn't one file](#why-it-isnt-one-file).

## Running it

```bash
npm install
npm run dev            # development server
npm run build          # static site -> dist/
npm run build:single   # one self-contained .html -> dist-single/
npm test               # 135 tests
```

## What it does

### Iterate by market, then type

A project is pinned to a **market** — senior living, healthcare, higher ed,
multifamily, hospitality, workplace, industrial, civic, parking. Within it,
each **scheme** explores one of 42 **building types**. Schemes are meant to be
forked, retyped, and compared rather than edited in place.

Picking a type seeds a plausible building immediately: massing defaults, unit
mix, net-to-gross band, parking ratio, support-space ratios. Set a capacity
target in the type's own unit — 200 apartments, 120 keys, 900 students — and
the program, the footprint, and the estimate follow.

### Cost data, layered

Nothing reads a cost number directly. Everything asks a resolver, which asks
whatever sources are registered, in priority order:

```
OverrideSource (100)  →  DESTINI live (70)  →  Imported export (50)  →  Seed (10)
```

The winner is returned bound to its **provenance** — source, date, basis,
sample size, confidence — and everything it outranked is kept and shown on the
line it superseded. Adding a live DESTINI endpoint is a registration, not a
refactor. See [docs/cost-data.md](docs/cost-data.md).

Your own history goes in through [docs/destini-data.md](docs/destini-data.md).

### Two estimates, reconciled

The scheme is priced twice, from data with no term in common:

- **Bottom-up** — quantities from the massing × resolved unit costs, rolled into
  UNIFORMAT divisions
- **Top-down** — the published $/GSF or $/capacity band for that market and type

Neither is the truth. The gap between them is the interesting number, and it is
reported rather than hidden behind a single figure — compared at the
benchmark's own scope, so a construction-scope band is never measured against a
total carrying design fees.

A coherence test seeds a realistic scheme for all 42 types and asserts the two
readings agree within 30%. It caught five genuine modelling defects while being
written.

### Rendering

Progressive accumulation: while the camera moves, one plain frame; the moment it
stops, samples accumulate with the projection jittered sub-pixel and the sun
jittered within a cone. Averaging those two jitters buys antialiasing well past
MSAA and genuinely soft shadows with contact darkening — no post-processing
chain, no extra dependency. It costs frames, which is exactly the resource
available when nobody is dragging the mouse.

Sun position is the real NOAA solar algorithm, so shadows fall where they
actually would for the site, date and hour.

### Photoreal pass

The viewport render is the draft. The photoreal pass conditions an image model
on it — plus **exact** depth, linework, and a material mask taken from the 3D
scene rather than estimated from a flat image. A pass driven by the beauty
render alone hallucinates floors and slides windows around, which is worse than
no render when the picture has to be the building that was priced.

Providers sit behind one interface (FLUX.1 Kontext, Replicate, Gemini) because
the vendor landscape moves — BFL deprecated the depth endpoints this feature was
originally designed around, mid-build.

### Presentation sheets

A concept summary and an options comparison at 17″ × 11″, printed straight to
PDF, with views captured from the live model. Each carries the estimate's basis
in the footer, because a number that leaves the building without its basis is
how a conceptual figure gets quoted back as a commitment.

## Why it isn't one file

It doesn't have to be, and at ~6,000 lines the original was already past what
one file should hold. What was worth keeping is the *delivery* format — a single
`.html` you can email or double-click — and that is now a build target
(`npm run build:single`) rather than a constraint on the source.

## Layout

```
src/
  markets/    market → building type → unit catalog registry
  costs/      schema, source contract, resolver, seed library, adapters
  domain/     massing, program, takeoff, estimate, project model
  render/     three.js pipeline, passes, AI providers
  app/        store, panels, sheets
  ui/         design system and primitives
tools/        DESTINI export aggregator
docs/         cost data architecture, DESTINI handoff
```

## Status

The seed cost library is **placeholder data** — planning-level industry ranges,
marked low confidence, stated at index 100. It exists so the tool works on day
one and so the shape of the DESTINI feed is exercised end to end. It is built to
be replaced, and the moment a real source is connected it is superseded
everywhere.
