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
  BayFeature,
  CanopyFeature,
  CorniceFeature,
  Feature,
  LobbyFeature,
  PorteCochereFeature,
  RoofScreenFeature,
  SunshadeFeature,
} from "@/domain/features";
import type { FacadeSegment } from "@/domain/footprint";
import { mergeGeometries } from "./massGeometry";

/** Which material a feature's geometry should be drawn with. */
export type FeatureMaterialKey = "canopy" | "glazing" | "storefront" | "mullion" | "wall" | "screen" | "trim";

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
    }
  }

  return out;
}

export type { Feature };
