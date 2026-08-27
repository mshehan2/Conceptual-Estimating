/**
 * Feature geometry.
 *
 * The drawing half of an architectural feature. Its pricing half lives in
 * `domain/features.ts`, and both read the same parameters — so a canopy that is
 * 30 feet wide in the render is 30 feet wide in the estimate, not because
 * anyone kept them in step but because there is only one number.
 *
 * Features are built in the mass's local frame and positioned against a facade
 * segment, so they land correctly on a diagonal wall of a hand-drawn plan just
 * as they do on the front of a rectangle.
 */

import * as THREE from "three";
import type { Mass } from "@/domain/massing";
import { massSegments, wallHeight } from "@/domain/massing";
import type {
  AtriumFeature,
  BalconyFeature,
  BayFeature,
  BriseSoleilFeature,
  CanopyFeature,
  ConnectorFeature,
  CorniceFeature,
  Feature,
  FeatureCornerFeature,
  LobbyFeature,
  LoggiaFeature,
  PergolaFeature,
  PlazaFeature,
  PorteCochereFeature,
  RoofScreenFeature,
  SunshadeFeature,
  TerraceFeature,
} from "@/domain/features";
import { footprintBounds, pointInFootprint, type FacadeSegment, type Footprint } from "@/domain/footprint";
import { massBands, mergeGeometries } from "./massGeometry";

/** Which material a feature's geometry should be drawn with. */
export type FeatureMaterialKey =
  | "canopy"
  | "glazing"
  | "storefront"
  | "mullion"
  | "wall"
  | "screen"
  | "trim"
  | "paving"
  | "planting";

export interface FeatureGeometry {
  featureId: string;
  material: FeatureMaterialKey;
  geometry: THREE.BufferGeometry;
}

/** Position and orientation of a feature against its wall. */
interface Placement {
  /** Midpoint of the feature along the wall, in plan. */
  x: number;
  z: number;
  /** Rotation so local +Z points out of the building. */
  rotationY: number;
  /** Length available along that wall. */
  wallLength: number;
}

function placeOn(segment: FacadeSegment, along: number, width: number): Placement {
  const clampedWidth = Math.min(width, segment.length);
  // Keep the feature inside the wall it is attached to.
  const half = clampedWidth / 2 / segment.length;
  const t = Math.max(half, Math.min(1 - half, along));
  return {
    x: segment.start[0] + (segment.end[0] - segment.start[0]) * t,
    z: segment.start[1] + (segment.end[1] - segment.start[1]) * t,
    rotationY: Math.atan2(segment.normal[0], segment.normal[1]),
    wallLength: segment.length,
  };
}

/** Place a box in the feature's local frame, then move it onto the wall. */
function partAt(
  w: number,
  h: number,
  d: number,
  localX: number,
  y: number,
  localZ: number,
  place: Placement,
): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(w, h, d);
  box.translate(localX, y, localZ);
  box.rotateY(place.rotationY);
  box.translate(place.x, 0, place.z);
  return box;
}

// ---------------------------------------------------------------------------

function canopyGeometry(f: CanopyFeature, place: Placement): FeatureGeometry[] {
  const width = Math.min(f.width, place.wallLength);
  const slab = 0.9;
  const parts = [partAt(width, slab, f.projection, 0, f.height, f.projection / 2, place)];

  if (f.support === "column") {
    const count = Math.max(2, Math.round(width / 14));
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = (t - 0.5) * (width - 1.4);
      parts.push(partAt(0.7, f.height, 0.7, x, f.height / 2, f.projection - 0.8, place));
    }
  } else if (f.support === "suspended") {
    // Tension rods back to the wall, which is what makes it read as suspended.
    for (const side of [-1, 1]) {
      const rod = new THREE.CylinderGeometry(0.12, 0.12, f.projection * 1.5, 6);
      rod.rotateX(Math.PI / 2.6);
      rod.translate(side * (width / 2 - 1), f.height + f.projection * 0.55, f.projection * 0.45);
      rod.rotateY(place.rotationY);
      rod.translate(place.x, 0, place.z);
      parts.push(rod);
    }
  }

  return [{ featureId: f.id, material: "canopy", geometry: mergeGeometries(parts)! }];
}

function porteCochereGeometry(f: PorteCochereFeature, place: Placement): FeatureGeometry[] {
  const width = Math.min(f.width, place.wallLength);
  const parts = [
    // Roof slab, slightly deeper than the drive so it reads as shelter.
    partAt(width, 1.6, f.projection, 0, f.height, f.projection / 2, place),
    // A fascia band around the outer edge.
    partAt(width, 2.6, 0.7, 0, f.height - 0.5, f.projection, place),
  ];

  const count = Math.max(2, f.columns);
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = (t - 0.5) * (width - 2.4);
    parts.push(partAt(1.3, f.height, 1.3, x, f.height / 2, f.projection - 1.2, place));
  }

  return [{ featureId: f.id, material: "canopy", geometry: mergeGeometries(parts)! }];
}

function bayGeometry(f: BayFeature, m: Mass, place: Placement): FeatureGeometry[] {
  const width = Math.min(f.width, place.wallLength);
  const top = Math.min(f.toFloor, m.floors - 1);
  const floors = Math.max(0, top - f.fromFloor + 1);
  if (floors <= 0) return [];

  const height = floors * m.fth;
  const baseY = f.fromFloor * m.fth;
  const body = partAt(width, height, f.projection, 0, baseY + height / 2, f.projection / 2, place);

  const out: FeatureGeometry[] = [
    { featureId: f.id, material: f.glazed ? "glazing" : "wall", geometry: body },
  ];

  if (f.glazed) {
    // A horizontal mullion at each floor line, so the bay reads as glazing
    // rather than as a slab of colour.
    const bars: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= floors; i++) {
      bars.push(partAt(width + 0.3, 0.45, f.projection + 0.3, 0, baseY + i * m.fth, f.projection / 2, place));
    }
    for (const side of [-1, 1]) {
      bars.push(partAt(0.4, height, f.projection + 0.3, (side * width) / 2, baseY + height / 2, f.projection / 2, place));
    }
    out.push({ featureId: f.id, material: "mullion", geometry: mergeGeometries(bars)! });
  }

  return out;
}

function lobbyGeometry(f: LobbyFeature, m: Mass, place: Placement): FeatureGeometry[] {
  const width = Math.min(f.width, place.wallLength);
  const height = f.floors * m.fth;

  const glass = partAt(width, height, f.projection, 0, height / 2, f.projection / 2, place);

  // A grid of mullions across the storefront: the single most recognisable
  // signal that a volume is a lobby and not a blank box.
  const bars: THREE.BufferGeometry[] = [];
  const bays = Math.max(2, Math.round(width / 5));
  for (let i = 0; i <= bays; i++) {
    const x = (i / bays - 0.5) * width;
    bars.push(partAt(0.35, height, f.projection + 0.25, x, height / 2, f.projection / 2, place));
  }
  for (let i = 0; i <= f.floors; i++) {
    bars.push(partAt(width + 0.25, 0.4, f.projection + 0.25, 0, i * m.fth, f.projection / 2, place));
  }
  // A capping band at the top of the volume.
  bars.push(partAt(width + 0.8, 1.1, f.projection + 0.6, 0, height + 0.4, f.projection / 2, place));

  return [
    { featureId: f.id, material: "storefront", geometry: glass },
    { featureId: f.id, material: "mullion", geometry: mergeGeometries(bars)! },
  ];
}

function sunshadeGeometry(f: SunshadeFeature, m: Mass, segments: FacadeSegment[]): FeatureGeometry[] {
  const targets = f.segment >= 0 ? [segments[f.segment]].filter(Boolean) : segments.filter((s) => !s.courtFacing);
  const floors = f.floors.length ? f.floors : Array.from({ length: m.floors }, (_, i) => i);
  const parts: THREE.BufferGeometry[] = [];

  for (const segment of targets) {
    const place = placeOn(segment, 0.5, segment.length * f.coverage);
    const width = segment.length * Math.max(0, Math.min(1, f.coverage));
    for (const floor of floors) {
      if (floor >= m.floors) continue;
      // Sit the shade just above the head of that floor's glazing.
      const y = floor * m.fth + Math.min(m.fth - 0.6, (m.sill ?? 3) + (m.glassH ?? 5) + 0.5);
      parts.push(partAt(width, 0.35, f.projection, 0, y, f.projection / 2, place));
      // Outrigger brackets, without which a shade reads as a floating plane.
      const brackets = Math.max(2, Math.round(width / 10));
      for (let i = 0; i < brackets; i++) {
        const t = brackets === 1 ? 0.5 : i / (brackets - 1);
        parts.push(
          partAt(0.25, 0.9, f.projection * 0.8, (t - 0.5) * (width - 1), y - 0.5, f.projection * 0.4, place),
        );
      }
    }
  }

  const merged = mergeGeometries(parts);
  return merged ? [{ featureId: f.id, material: "screen", geometry: merged }] : [];
}

function roofScreenGeometry(f: RoofScreenFeature, m: Mass, segments: FacadeSegment[]): FeatureGeometry[] {
  const top = wallHeight(m) + 3.2;
  const outer = segments.filter((s) => !s.courtFacing);
  const covered = Math.max(0, Math.min(1, f.coverage));
  const parts: THREE.BufferGeometry[] = [];

  // Screen the walls nearest the back of the building first, which is where
  // rooftop plant actually goes.
  const ordered = [...outer].sort((a, b) => a.bearing - b.bearing);
  const take = Math.max(1, Math.round(ordered.length * covered));

  for (const segment of ordered.slice(0, take)) {
    const place = placeOn(segment, 0.5, segment.length);
    parts.push(partAt(segment.length, f.height, 0.5, 0, top + f.height / 2, -2.5, place));
    // Louvre blades, so the screen is legible as a screen.
    if (f.material === "louver") {
      const blades = Math.max(2, Math.floor(f.height / 1.2));
      for (let i = 0; i < blades; i++) {
        parts.push(
          partAt(segment.length, 0.22, 0.9, 0, top + 0.6 + i * 1.2, -2.2, place),
        );
      }
    }
  }

  const merged = mergeGeometries(parts);
  return merged ? [{ featureId: f.id, material: "screen", geometry: merged }] : [];
}

function corniceGeometry(f: CorniceFeature, m: Mass, segments: FacadeSegment[]): FeatureGeometry[] {
  const y = wallHeight(m) + 3.2;
  const parts: THREE.BufferGeometry[] = [];
  for (const segment of segments.filter((s) => !s.courtFacing)) {
    const place = placeOn(segment, 0.5, segment.length);
    parts.push(partAt(segment.length + f.projection * 2, f.depth, f.projection, 0, y - f.depth / 2, f.projection / 2, place));
  }
  const merged = mergeGeometries(parts);
  return merged ? [{ featureId: f.id, material: "trim", geometry: merged }] : [];
}

/** Vertical fins or deep horizontal blades across a glazed elevation. */
function briseSoleilGeometry(f: BriseSoleilFeature, m: Mass, segments: FacadeSegment[]): FeatureGeometry[] {
  const targets = f.segment >= 0 ? [segments[f.segment]].filter(Boolean) : segments.filter((s) => !s.courtFacing);
  const height = m.floors * m.fth;
  const parts: THREE.BufferGeometry[] = [];

  for (const segment of targets) {
    const run = segment.length * Math.max(0, Math.min(1, f.coverage));
    const place = placeOn(segment, 0.5, run);
    const spacing = Math.max(0.75, f.spacing);

    if (f.orientation === "vertical") {
      const fins = Math.max(1, Math.floor(run / spacing));
      for (let i = 0; i < fins; i++) {
        const x = (i / Math.max(1, fins - 1) - 0.5) * (run - 0.6);
        parts.push(partAt(0.35, height, f.projection, x, height / 2, f.projection / 2, place));
      }
    } else {
      const blades = Math.max(1, Math.floor(height / spacing));
      for (let i = 0; i < blades; i++) {
        const y = (i + 0.5) * (height / blades);
        parts.push(partAt(run, 0.3, f.projection, 0, y, f.projection / 2, place));
      }
    }
  }

  const merged = mergeGeometries(parts);
  return merged ? [{ featureId: f.id, material: "screen", geometry: merged }] : [];
}

/** Balconies repeated up the elevation, with a guard rail on each. */
function balconyGeometry(f: BalconyFeature, m: Mass, place: Placement): FeatureGeometry[] {
  const top = Math.min(f.toFloor, m.floors - 1);
  const levels = Math.max(0, top - f.fromFloor + 1);
  if (levels <= 0) return [];

  const decks: THREE.BufferGeometry[] = [];
  const rails: THREE.BufferGeometry[] = [];
  const count = Math.max(1, f.count);
  const span = place.wallLength - 6;

  for (let level = 0; level < levels; level++) {
    const y = (f.fromFloor + level) * m.fth;
    for (let i = 0; i < count; i++) {
      const x = count === 1 ? 0 : (i / (count - 1) - 0.5) * span;
      // A recessed balcony sits inside the face; a projecting one hangs off it.
      const z = f.recessed ? -f.projection / 2 : f.projection / 2;
      decks.push(partAt(f.width, 0.7, f.projection, x, y + 0.35, z, place));

      if (!f.recessed) {
        const railY = y + 2.2;
        rails.push(partAt(f.width, 0.2, 0.15, x, railY, f.projection, place));
        for (const side of [-1, 1]) {
          rails.push(partAt(0.15, 3.4, f.projection, x + (side * f.width) / 2, y + 1.9, z, place));
        }
      } else {
        rails.push(partAt(f.width, 0.2, 0.15, x, y + 2.2, 0, place));
      }
    }
  }

  const out: FeatureGeometry[] = [];
  const deck = mergeGeometries(decks);
  const rail = mergeGeometries(rails);
  if (deck) out.push({ featureId: f.id, material: "trim", geometry: deck });
  if (rail) out.push({ featureId: f.id, material: "screen", geometry: rail });
  return out;
}

/** A recessed outdoor room: a dark void with a soffit and a rail. */
function loggiaGeometry(f: LoggiaFeature, m: Mass, place: Placement): FeatureGeometry[] {
  const top = Math.min(f.toFloor, m.floors - 1);
  const levels = Math.max(0, top - f.fromFloor + 1);
  if (levels <= 0) return [];

  const width = Math.min(f.width, place.wallLength);
  const parts: THREE.BufferGeometry[] = [];

  for (let level = 0; level < levels; level++) {
    const y = (f.fromFloor + level) * m.fth;
    // Back wall of the recess, set into the plan.
    parts.push(partAt(width, m.fth, 0.6, 0, y + m.fth / 2, -f.depth, place));
    // Soffit over the opening.
    parts.push(partAt(width, 0.5, f.depth, 0, y + m.fth - 0.25, -f.depth / 2, place));
    // Side reveals.
    for (const side of [-1, 1]) {
      parts.push(partAt(0.6, m.fth, f.depth, (side * width) / 2, y + m.fth / 2, -f.depth / 2, place));
    }
  }

  const merged = mergeGeometries(parts);
  return merged ? [{ featureId: f.id, material: "wall", geometry: merged }] : [];
}

/** A glazed corner wrapping two walls. */
function featureCornerGeometry(
  f: FeatureCornerFeature,
  m: Mass,
  segments: FacadeSegment[],
): FeatureGeometry[] {
  const segment = segments[f.segment];
  if (!segment) return [];
  const next = segments[(f.segment + 1) % segments.length];

  const top = Math.min(f.toFloor, m.floors - 1);
  const levels = Math.max(0, top - f.fromFloor + 1);
  if (levels <= 0) return [];
  const height = levels * m.fth;
  const baseY = f.fromFloor * m.fth;

  const glass: THREE.BufferGeometry[] = [];
  const bars: THREE.BufferGeometry[] = [];

  // Wrap the end of this wall and the start of the next, meeting at the corner.
  for (const [seg, atEnd] of [[segment, true], [next, false]] as const) {
    if (!seg) continue;
    const wrap = Math.min(f.wrap, seg.length);
    const along = atEnd ? 1 - wrap / seg.length / 2 : wrap / seg.length / 2;
    const place = placeOn(seg, along, wrap);
    glass.push(partAt(wrap, height, 0.5, 0, baseY + height / 2, 0.25, place));
    for (let i = 0; i <= levels; i++) {
      bars.push(partAt(wrap + 0.2, 0.35, 0.7, 0, baseY + i * m.fth, 0.3, place));
    }
  }

  const out: FeatureGeometry[] = [];
  const g = mergeGeometries(glass);
  const b = mergeGeometries(bars);
  if (g) out.push({ featureId: f.id, material: "storefront", geometry: g });
  if (b) out.push({ featureId: f.id, material: "mullion", geometry: b });
  return out;
}

/** A skylight over an atrium. The void itself is interior, so only the lid shows. */
function atriumGeometry(f: AtriumFeature, m: Mass): FeatureGeometry[] {
  if (!f.skylight) return [];
  const y = m.floors * m.fth + 0.8;
  const glass = new THREE.BoxGeometry(f.width, 0.5, f.depth);
  glass.translate(0, y + 1.2, 0);

  const bars: THREE.BufferGeometry[] = [];
  const bays = Math.max(2, Math.round(f.width / 8));
  for (let i = 0; i <= bays; i++) {
    const bar = new THREE.BoxGeometry(0.4, 0.9, f.depth + 0.4);
    bar.translate((i / bays - 0.5) * f.width, y + 1.2, 0);
    bars.push(bar);
  }
  // A low upstand kerb so the skylight reads as sitting on the roof.
  const kerb = new THREE.BoxGeometry(f.width + 1.6, 1.6, f.depth + 1.6);
  kerb.translate(0, y + 0.3, 0);
  bars.push(kerb);

  return [
    { featureId: f.id, material: "storefront", geometry: glass },
    { featureId: f.id, material: "mullion", geometry: mergeGeometries(bars)! },
  ];
}

/** A link bridge projecting from a wall. */
function connectorGeometry(f: ConnectorFeature, m: Mass, place: Placement): FeatureGeometry[] {
  const height = Math.max(1, f.floors) * m.fth;
  const y = f.height;
  const parts = [partAt(f.width, height, f.length, 0, y + height / 2, f.length / 2, place)];
  const bars: THREE.BufferGeometry[] = [];

  if (f.glazed) {
    const bays = Math.max(2, Math.round(f.length / 8));
    for (let i = 0; i <= bays; i++) {
      bars.push(partAt(f.width + 0.3, 0.4, 0.4, 0, y + height / 2, (i / bays) * f.length, place));
    }
  }
  // Floor and roof bands so it reads as a bridge rather than a glass tube.
  bars.push(partAt(f.width + 0.5, 0.8, f.length, 0, y, f.length / 2, place));
  bars.push(partAt(f.width + 0.5, 0.8, f.length, 0, y + height, f.length / 2, place));

  return [
    { featureId: f.id, material: f.glazed ? "storefront" : "wall", geometry: mergeGeometries(parts)! },
    { featureId: f.id, material: "mullion", geometry: mergeGeometries(bars)! },
  ];
}

/** A roof terrace: deck, rail and planters on the highest setback. */
/**
 * Somewhere on this roof a deck of this size actually fits.
 *
 * The centre used to be the mean of the outline's VERTICES, which is not the
 * centre of anything. On an L it lands in the notch, so a roof terrace the
 * estimate was charging for hung in mid-air outside the building.
 *
 * Scan for a placement instead, and test a grid across the whole deck rather
 * than only its corners — on a concave plan four corners can each be inside
 * the building while the middle of the deck spans the court.
 */
function fitDeck(
  plan: Footprint,
  wantW: number,
  wantD: number,
): { x: number; z: number; w: number; d: number } | null {
  const bounds = footprintBounds(plan);
  const cx0 = (bounds.minX + bounds.maxX) / 2;
  const cz0 = (bounds.minZ + bounds.maxZ) / 2;

  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = 0.82 ** attempt;
    const dw = wantW * scale;
    const dd = wantD * scale;
    const roomX = bounds.maxX - bounds.minX - dw;
    const roomZ = bounds.maxZ - bounds.minZ - dd;
    if (roomX < 0 || roomZ < 0) continue;

    let best: { x: number; z: number; score: number } | null = null;
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const x = bounds.minX + dw / 2 + (roomX * i) / steps;
        const z = bounds.minZ + dd / 2 + (roomZ * j) / steps;
        let ok = true;
        for (let a = 0; a <= 3 && ok; a++) {
          for (let b = 0; b <= 3 && ok; b++) {
            const px = x - dw / 2 + (dw * a) / 3;
            const pz = z - dd / 2 + (dd * b) / 3;
            if (!pointInFootprint(plan, px, pz)) ok = false;
          }
        }
        if (!ok) continue;
        const score = (x - cx0) ** 2 + (z - cz0) ** 2;
        if (!best || score < best.score) best = { x, z, score };
      }
    }
    if (best) return { x: best.x, z: best.z, w: dw, d: dd };
  }
  return null;
}

function terraceGeometry(
  f: TerraceFeature,
  m: Mass,
  bandTopY: number,
  ring: [number, number][],
  holes: [number, number][][] = [],
): FeatureGeometry[] {
  const side = Math.sqrt(Math.max(1, f.area));
  const plan: Footprint = { kind: "polygon", w: m.w, d: m.d, points: ring, holes };
  const fit = fitDeck(plan, side, side * 0.7);
  // A roof with nowhere to put a deck draws nothing rather than putting one
  // over open air. If this ever fires in practice the terrace is the wrong
  // feature for that mass, and an invisible deck says so more honestly than a
  // floating one.
  if (!fit) return [];

  const { x: cx, z: cz, w: deckW, d: deckD } = fit;
  const deck = new THREE.BoxGeometry(deckW, 0.4, deckD);
  deck.translate(cx, bandTopY + 0.9, cz);

  const rails: THREE.BufferGeometry[] = [];
  const halfW = deckW / 2;
  const halfD = deckD / 2;
  for (const [dx, dz, w, d] of [
    [0, halfD, deckW, 0.15],
    [0, -halfD, deckW, 0.15],
    [halfW, 0, 0.15, deckD],
    [-halfW, 0, 0.15, deckD],
  ] as const) {
    const rail = new THREE.BoxGeometry(w, 3.4, d);
    rail.translate(cx + dx, bandTopY + 2.6, cz + dz);
    rails.push(rail);
  }

  const out: FeatureGeometry[] = [
    { featureId: f.id, material: "trim", geometry: deck },
    { featureId: f.id, material: "screen", geometry: mergeGeometries(rails)! },
  ];

  if (f.planters) {
    const planters: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const box = new THREE.BoxGeometry(deckW * 0.18, 2.6, deckD * 0.17);
      box.translate(cx + (i / 3 - 0.5) * deckW * 0.8, bandTopY + 2.2, cz - halfD + 2.5);
      planters.push(box);
    }
    out.push({ featureId: f.id, material: "planting", geometry: mergeGeometries(planters)! });
  }
  return out;
}

/** Entry plaza or patio at grade, with an optional seat wall. */
function plazaGeometry(f: PlazaFeature, place: Placement): FeatureGeometry[] {
  const paving = partAt(f.width, 0.25, f.depth, 0, 0.12, f.depth / 2 + 1, place);
  const out: FeatureGeometry[] = [{ featureId: f.id, material: "paving", geometry: paving }];

  if (f.seatWall > 0) {
    const walls: THREE.BufferGeometry[] = [
      partAt(Math.min(f.seatWall, f.width), 1.6, 1.4, 0, 0.8, f.depth + 1, place),
    ];
    out.push({ featureId: f.id, material: "trim", geometry: mergeGeometries(walls)! });
  }
  return out;
}

/** A pergola over a patio: posts and a slatted top. */
function pergolaGeometry(f: PergolaFeature, place: Placement): FeatureGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const post = 0.55;

  for (const sx of [-1, 1]) {
    for (const sz of [0.15, 0.95]) {
      parts.push(partAt(post, f.height, post, (sx * (f.width - post)) / 2, f.height / 2, f.projection * sz, place));
    }
  }
  // Beams along the length, then slats across them.
  for (const sx of [-1, 1]) {
    parts.push(partAt(0.4, 0.9, f.projection, (sx * (f.width - post)) / 2, f.height, f.projection / 2, place));
  }
  const slats = Math.max(3, Math.round(f.width / 1.6));
  for (let i = 0; i < slats; i++) {
    const x = (i / (slats - 1) - 0.5) * (f.width - 0.8);
    parts.push(partAt(0.3, 0.7, f.projection + 0.8, x, f.height + 0.7, f.projection / 2, place));
  }

  return [{ featureId: f.id, material: "screen", geometry: mergeGeometries(parts)! }];
}

// ---------------------------------------------------------------------------

/** Geometry for every enabled feature on a mass. */
export function featureGeometries(m: Mass): FeatureGeometry[] {
  const features = m.features ?? [];
  if (!features.length) return [];

  const segments = massSegments(m);
  const out: FeatureGeometry[] = [];

  for (const feature of features) {
    if (feature.disabled) continue;

    // Whole-building features do their own segment selection.
    if (feature.kind === "sunshade") {
      out.push(...sunshadeGeometry(feature, m, segments));
      continue;
    }
    if (feature.kind === "brise_soleil") {
      out.push(...briseSoleilGeometry(feature, m, segments));
      continue;
    }
    if (feature.kind === "feature_corner") {
      out.push(...featureCornerGeometry(feature, m, segments));
      continue;
    }
    if (feature.kind === "atrium") {
      out.push(...atriumGeometry(feature, m));
      continue;
    }
    if (feature.kind === "terrace") {
      const bands = massBands(m);
      const band = bands.length > 1 ? bands[bands.length - 2] : bands[0];
      out.push(...terraceGeometry(feature, m, band.baseY + band.height, band.ring, band.holes));
      continue;
    }
    if (feature.kind === "roof_screen") {
      out.push(...roofScreenGeometry(feature, m, segments));
      continue;
    }
    if (feature.kind === "cornice") {
      out.push(...corniceGeometry(feature, m, segments));
      continue;
    }

    const segment = segments[feature.segment];
    // A feature can outlive the wall it was attached to — after a shape change,
    // say — so it is skipped rather than crashing the whole render.
    if (!segment) continue;
    const place = placeOn(segment, feature.along, "width" in feature ? feature.width : 10);

    switch (feature.kind) {
      case "canopy":
        out.push(...canopyGeometry(feature, place));
        break;
      case "porte_cochere":
        out.push(...porteCochereGeometry(feature, place));
        break;
      case "bay":
        out.push(...bayGeometry(feature, m, place));
        break;
      case "lobby":
        out.push(...lobbyGeometry(feature, m, place));
        break;
      case "balcony":
        out.push(...balconyGeometry(feature, m, place));
        break;
      case "loggia":
        out.push(...loggiaGeometry(feature, m, place));
        break;
      case "connector":
        out.push(...connectorGeometry(feature, m, place));
        break;
      case "plaza":
        out.push(...plazaGeometry(feature, place));
        break;
      case "pergola":
        out.push(...pergolaGeometry(feature, place));
        break;
    }
  }

  return out;
}

export type { Feature };
