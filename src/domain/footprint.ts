/**
 * Building footprints.
 *
 * Every footprint is a polygon. L, U, T and courtyard plans are presets that
 * generate one; a custom plan is one you drew or imported. That is deliberate:
 * a real project gets shaped by its site, and a tool that only offers named
 * shapes eventually tells an estimator their building is not allowed.
 *
 * Facades are the polygon's edges. Each edge carries its own length, outward
 * normal and cardinal orientation, so glazing and cladding can be set per
 * cardinal direction (the common case) or per individual edge (the exception),
 * without the geometry code caring which.
 *
 * Coordinates are feet, in the mass's local frame: +x right, +z toward the
 * viewer, origin at the footprint centroid of the bounding box.
 */

export type Point = [x: number, z: number];

export type Cardinal = "N" | "E" | "S" | "W";

/** Legacy four-sided naming, kept because program and cost code still speak it. */
export type Facade = "f" | "b" | "l" | "r";

export const CARDINAL_TO_FACADE: Record<Cardinal, Facade> = { N: "f", S: "b", W: "l", E: "r" };

export type FootprintKind = "rect" | "L" | "U" | "T" | "courtyard" | "polygon";

export interface FootprintBase {
  kind: FootprintKind;
  /** Overall bounding width, feet. */
  w: number;
  /** Overall bounding depth, feet. */
  d: number;
}

export interface RectFootprint extends FootprintBase {
  kind: "rect";
}

/** An L: a full bar plus a wing, with the notch cut from one corner. */
export interface LFootprint extends FootprintBase {
  kind: "L";
  /** Width of the wing, as a fraction of `w`, 0.15..0.85. */
  armW: number;
  /** Depth of the main bar, as a fraction of `d`, 0.15..0.85. */
  armD: number;
  /** Which corner the notch is cut from. */
  notch: "ne" | "nw" | "se" | "sw";
}

/** A U: two wings off a spine, with a court open on one side. */
export interface UFootprint extends FootprintBase {
  kind: "U";
  /** Width of each wing, as a fraction of `w`, 0.12..0.45. */
  armW: number;
  /** Depth of the court, as a fraction of `d`, 0.2..0.85. */
  courtD: number;
  /** Which side the court opens toward. */
  open: Cardinal;
}

/** A T: a bar with a stem projecting from the middle of one face. */
export interface TFootprint extends FootprintBase {
  kind: "T";
  /** Width of the stem, as a fraction of `w`, 0.15..0.7. */
  stemW: number;
  /** Depth of the bar, as a fraction of `d`, 0.2..0.8. */
  barD: number;
  /** Which side the stem projects from. */
  stem: Cardinal;
}

/** A doughnut: an outer ring around an enclosed court. */
export interface CourtyardFootprint extends FootprintBase {
  kind: "courtyard";
  /** Court width as a fraction of `w`, 0.15..0.8. */
  courtW: number;
  /** Court depth as a fraction of `d`, 0.15..0.8. */
  courtD: number;
  /** Court centre offset from the footprint centre, as fractions of w and d. */
  offsetX: number;
  offsetZ: number;
}

/** Arbitrary geometry: drawn, imported, or traced off a survey. */
export interface PolygonFootprint extends FootprintBase {
  kind: "polygon";
  /** Outer ring, counter-clockwise, in feet. Not required to be convex. */
  points: Point[];
  /** Optional enclosed voids, e.g. a light well. */
  holes?: Point[][];
}

export type Footprint =
  | RectFootprint
  | LFootprint
  | UFootprint
  | TFootprint
  | CourtyardFootprint
  | PolygonFootprint;

export const rectFootprint = (w: number, d: number): RectFootprint => ({ kind: "rect", w, d });

/**
 * A footprint's shape without its size.
 *
 * Overall width and depth live on the mass, so they are edited in one place and
 * cannot drift from the shape parameters. `composeFootprint` puts the two back
 * together for any code that needs a complete footprint.
 */
export type FootprintShape =
  | { kind: "rect" }
  | { kind: "L"; armW: number; armD: number; notch: "ne" | "nw" | "se" | "sw" }
  | { kind: "U"; armW: number; courtD: number; open: Cardinal }
  | { kind: "T"; stemW: number; barD: number; stem: Cardinal }
  | { kind: "courtyard"; courtW: number; courtD: number; offsetX: number; offsetZ: number }
  | { kind: "polygon"; points: Point[]; holes?: Point[][] };

export const composeFootprint = (shape: FootprintShape, w: number, d: number): Footprint =>
  ({ ...shape, w, d }) as Footprint;

/** Default parameters for each preset, so switching shape gives a usable plan. */
export function defaultShape(kind: FootprintKind): FootprintShape {
  switch (kind) {
    case "rect":
      return { kind: "rect" };
    case "L":
      return { kind: "L", armW: 0.45, armD: 0.5, notch: "ne" };
    case "U":
      return { kind: "U", armW: 0.26, courtD: 0.5, open: "S" };
    case "T":
      return { kind: "T", stemW: 0.34, barD: 0.5, stem: "N" };
    case "courtyard":
      return { kind: "courtyard", courtW: 0.4, courtD: 0.4, offsetX: 0, offsetZ: 0 };
    case "polygon":
      // Seeded from a rectangle so "make it custom" starts from what is there
      // rather than from an empty canvas.
      return { kind: "polygon", points: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] };
  }
}

export const FOOTPRINT_LABELS: Record<FootprintKind, string> = {
  rect: "Rectangle",
  L: "L-shape",
  U: "U-shape",
  T: "T-shape",
  courtyard: "Courtyard",
  polygon: "Custom",
};

/**
 * Turn any footprint into an editable custom polygon.
 *
 * This is how a preset stops being a preset: pull a vertex on an L and it
 * becomes yours, with every downstream consumer none the wiser because they
 * only ever saw a polygon anyway.
 */
export function toPolygonShape(f: Footprint): FootprintShape {
  return { kind: "polygon", points: outerRing(f).map(([x, z]) => [x, z] as Point), holes: holeRings(f).map((h) => h.map(([x, z]) => [x, z] as Point)) };
}

// ---------------------------------------------------------------------------
// Ring generation
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Outer ring of a footprint, counter-clockwise. */
export function outerRing(f: Footprint): Point[] {
  const hw = f.w / 2;
  const hd = f.d / 2;

  switch (f.kind) {
    case "rect":
      return [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ];

    case "L": {
      const aw = clamp(f.armW, 0.15, 0.85) * f.w;
      const ad = clamp(f.armD, 0.15, 0.85) * f.d;
      // Full rectangle with one corner removed. The removed corner spans
      // (w - aw) by (d - ad), leaving an L of constant limb widths.
      const cutW = f.w - aw;
      const cutD = f.d - ad;
      switch (f.notch) {
        case "ne":
          return [[-hw, -hd], [hw, -hd], [hw, hd - cutD], [hw - cutW, hd - cutD], [hw - cutW, hd], [-hw, hd]];
        case "nw":
          return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw + cutW, hd], [-hw + cutW, hd - cutD], [-hw, hd - cutD]];
        case "se":
          return [[-hw, -hd], [hw - cutW, -hd], [hw - cutW, -hd + cutD], [hw, -hd + cutD], [hw, hd], [-hw, hd]];
        case "sw":
        default:
          return [[-hw + cutW, -hd], [hw, -hd], [hw, hd], [-hw, hd], [-hw, -hd + cutD], [-hw + cutW, -hd + cutD]];
      }
    }

    case "U": {
      const aw = clamp(f.armW, 0.12, 0.45) * f.w;
      const cd = clamp(f.courtD, 0.2, 0.85) * f.d;
      // Built facing north, then rotated into place, so there is one shape to
      // get right rather than four near-identical ones to keep in step.
      const ring: Point[] = [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [hw - aw, hd],
        [hw - aw, hd - cd],
        [-hw + aw, hd - cd],
        [-hw + aw, hd],
        [-hw, hd],
      ];
      return rotateRingTo(ring, f.open);
    }

    case "T": {
      const sw = clamp(f.stemW, 0.15, 0.7) * f.w;
      const bd = clamp(f.barD, 0.2, 0.8) * f.d;
      const stemD = f.d - bd;
      // Bar across the south edge, stem projecting north, then rotated.
      const ring: Point[] = [
        [-hw, -hd],
        [hw, -hd],
        [hw, -hd + bd],
        [sw / 2, -hd + bd],
        [sw / 2, -hd + bd + stemD],
        [-sw / 2, -hd + bd + stemD],
        [-sw / 2, -hd + bd],
        [-hw, -hd + bd],
      ];
      return rotateRingTo(ring, f.stem);
    }

    case "courtyard":
      return [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ];

    case "polygon":
      return normalizeWinding(f.points);
  }
}

/** Enclosed voids: the court of a courtyard plan, or explicit holes. */
export function holeRings(f: Footprint): Point[][] {
  if (f.kind === "courtyard") {
    const cw = clamp(f.courtW, 0.15, 0.8) * f.w;
    const cd = clamp(f.courtD, 0.15, 0.8) * f.d;
    const cx = clamp(f.offsetX, -0.35, 0.35) * f.w;
    const cz = clamp(f.offsetZ, -0.35, 0.35) * f.d;
    // Hold a minimum limb width so the ring cannot pinch to nothing.
    const maxW = f.w - 24;
    const maxD = f.d - 24;
    const w = Math.min(cw, Math.max(8, maxW));
    const d = Math.min(cd, Math.max(8, maxD));
    const hole: Point[] = [
      [cx - w / 2, cz - d / 2],
      [cx - w / 2, cz + d / 2],
      [cx + w / 2, cz + d / 2],
      [cx + w / 2, cz - d / 2],
    ];
    return [hole]; // clockwise, opposite the outer ring
  }
  if (f.kind === "polygon" && f.holes?.length) {
    return f.holes.map((h) => normalizeWinding(h).slice().reverse());
  }
  return [];
}

/** Rotate a north-facing ring so its opening points at `to`. */
function rotateRingTo(ring: Point[], to: Cardinal): Point[] {
  const turns = { N: 0, W: 1, S: 2, E: 3 }[to];
  let out = ring;
  for (let i = 0; i < turns; i++) out = out.map(([x, z]) => [z, -x] as Point);
  return out;
}

/** Force counter-clockwise winding, so outward normals are consistent. */
function normalizeWinding(points: Point[]): Point[] {
  return signedArea(points) < 0 ? points.slice().reverse() : points.slice();
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

export function signedArea(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    sum += x0 * z1 - x1 * z0;
  }
  return sum / 2;
}

export const ringArea = (ring: Point[]): number => Math.abs(signedArea(ring));

export function ringPerimeter(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    sum += Math.hypot(x1 - x0, z1 - z0);
  }
  return sum;
}

/** Floor plate area: outer ring less any enclosed court. */
export function footprintArea(f: Footprint): number {
  const outer = ringArea(outerRing(f));
  const holes = holeRings(f).reduce((a, h) => a + ringArea(h), 0);
  return Math.max(0, outer - holes);
}

/** Total wall length, including the walls facing an enclosed court. */
export function footprintPerimeter(f: Footprint): number {
  return (
    ringPerimeter(outerRing(f)) + holeRings(f).reduce((a, h) => a + ringPerimeter(h), 0)
  );
}

// ---------------------------------------------------------------------------
// Facades
// ---------------------------------------------------------------------------

export interface FacadeSegment {
  /** Stable index within the footprint, for per-edge overrides. */
  index: number;
  start: Point;
  end: Point;
  length: number;
  /** Outward normal, unit length. */
  normal: Point;
  /** Bearing of the outward normal, degrees clockwise from north. */
  bearing: number;
  cardinal: Cardinal;
  /** Legacy f/b/l/r label, from the cardinal. */
  side: Facade;
  /** True when this wall faces an enclosed court rather than the outside. */
  courtFacing: boolean;
}

const bearingOf = ([nx, nz]: Point): number => {
  // North is +z, east is +x.
  const deg = (Math.atan2(nx, nz) * 180) / Math.PI;
  return (deg + 360) % 360;
};

const cardinalOf = (bearing: number): Cardinal => {
  if (bearing >= 315 || bearing < 45) return "N";
  if (bearing < 135) return "E";
  if (bearing < 225) return "S";
  return "W";
};

/**
 * Every wall of a footprint, outer ring first then any court.
 *
 * Zero-length edges are dropped: a preset at an extreme parameter can collapse
 * one, and a zero-length wall would otherwise contribute a zero-area facade
 * that still costs a corner and confuses per-edge overrides.
 */
export function facadeSegments(f: Footprint): FacadeSegment[] {
  const segments: FacadeSegment[] = [];
  let index = 0;

  const walk = (ring: Point[], courtFacing: boolean) => {
    for (let i = 0; i < ring.length; i++) {
      const start = ring[i];
      const end = ring[(i + 1) % ring.length];
      const dx = end[0] - start[0];
      const dz = end[1] - start[1];
      const length = Math.hypot(dx, dz);
      if (length < 0.05) continue;

      // Counter-clockwise winding puts the outward normal to the right of
      // travel; a court ring is wound the other way, which flips it inward
      // exactly as it should.
      const normal: Point = [dz / length, -dx / length];
      const bearing = bearingOf(normal);
      segments.push({
        index: index++,
        start,
        end,
        length,
        normal,
        bearing,
        cardinal: cardinalOf(bearing),
        side: CARDINAL_TO_FACADE[cardinalOf(bearing)],
        courtFacing,
      });
    }
  };

  walk(outerRing(f), false);
  for (const hole of holeRings(f)) walk(hole, true);
  return segments;
}

/** Bounding box of a footprint, useful for camera framing and site fit. */
/**
 * The thinnest solid run through the plan in the depth direction, in feet.
 *
 * A preset shape takes its arms as fractions of the bounding box, so an L
 * drawn in a box only as deep as one good floor plate becomes two half-depth
 * wings. Sizing has to know that, and it cannot read it off the shape's own
 * parameters: a U opening east has its court cut from the width, and a
 * hand-drawn polygon has no parameters at all. So measure it — scan across
 * the width, and take the shortest solid interval anywhere.
 */
export function minLimbDepth(f: Footprint, samples = 41): number {
  const rings = [outerRing(f), ...holeRings(f)];
  const bounds = footprintBounds(f);
  const span = bounds.maxX - bounds.minX;
  if (span <= 0) return f.d;

  let thinnest = Infinity;
  for (let i = 0; i < samples; i++) {
    // Offset the sample so it does not land on a vertex, where a scanline
    // counts an edge twice and reports a limb of zero depth.
    const x = bounds.minX + (span * (i + 0.5)) / samples;
    const crossings: number[] = [];
    for (const ring of rings) {
      for (let j = 0; j < ring.length; j++) {
        const [x0, z0] = ring[j];
        const [x1, z1] = ring[(j + 1) % ring.length];
        if (x0 <= x === x1 <= x) continue;
        crossings.push(z0 + ((z1 - z0) * (x - x0)) / (x1 - x0));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      thinnest = Math.min(thinnest, crossings[k + 1] - crossings[k]);
    }
  }
  return Number.isFinite(thinnest) ? thinnest : f.d;
}

export function footprintBounds(f: Footprint): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const ring = outerRing(f);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Inset a ring by a distance, for stepped massing.
 *
 * Each edge is pushed inward along its normal and adjacent edges re-intersected.
 * That is the correct offset for convex and mildly concave rings, and it is
 * what a setback actually is. A deep inset on a re-entrant corner can make the
 * result self-intersect, so the outcome is validated and falls back to scaling
 * about the centroid — an approximation, but a stable one that never emits
 * geometry with a negative or inverted area.
 */
export function insetRing(ring: Point[], distance: number): Point[] {
  if (distance <= 0 || ring.length < 3) return ring.slice();

  const lines: { point: Point; dir: Point }[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const dir: Point = [dx / len, dz / len];
    // Outward normal is to the right of travel on a counter-clockwise ring, so
    // inward is its negation.
    const inward: Point = [-dz / len, dx / len];
    lines.push({ point: [x0 + inward[0] * distance, z0 + inward[1] * distance], dir });
  }
  if (lines.length < 3) return ring.slice();

  const out: Point[] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    const b = lines[(i + 1) % lines.length];
    const hit = intersectLines(a.point, a.dir, b.point, b.dir);
    if (!hit) return scaleAboutCentroid(ring, distance);
    out.push(hit);
  }

  // Reject a collapsed or inverted result rather than passing it downstream.
  if (out.length < 3 || signedArea(out) <= 1) return scaleAboutCentroid(ring, distance);
  return out;
}

function intersectLines(p: Point, r: Point, q: Point, s: Point): Point | null {
  const denominator = r[0] * s[1] - r[1] * s[0];
  // Parallel edges never meet; a rounding-scale denominator is the same case.
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / denominator;
  return [p[0] + r[0] * t, p[1] + r[1] * t];
}

/** Fallback inset: shrink about the centroid to lose a similar amount of area. */
function scaleAboutCentroid(ring: Point[], distance: number): Point[] {
  const area = ringArea(ring);
  const perimeter = ringPerimeter(ring);
  if (area <= 0 || perimeter <= 0) return ring.slice();

  // Removing a band of `distance` around the edge loses about perimeter x
  // distance of area; convert that to a linear scale factor.
  const target = Math.max(area * 0.05, area - perimeter * distance);
  const scale = Math.sqrt(target / area);

  let cx = 0;
  let cz = 0;
  for (const [x, z] of ring) {
    cx += x;
    cz += z;
  }
  cx /= ring.length;
  cz /= ring.length;

  return ring.map(([x, z]) => [cx + (x - cx) * scale, cz + (z - cz) * scale] as Point);
}

/** Scale a footprint's overall size while keeping its proportions. */
export function resizeFootprint(f: Footprint, w: number, d: number): Footprint {
  if (f.kind === "polygon") {
    const bounds = footprintBounds(f);
    const sx = (bounds.maxX - bounds.minX) > 0 ? w / (bounds.maxX - bounds.minX) : 1;
    const sz = (bounds.maxZ - bounds.minZ) > 0 ? d / (bounds.maxZ - bounds.minZ) : 1;
    return {
      ...f,
      w,
      d,
      points: f.points.map(([x, z]) => [x * sx, z * sz] as Point),
      holes: f.holes?.map((h) => h.map(([x, z]) => [x * sx, z * sz] as Point)),
    };
  }
  return { ...f, w, d };
}
