/**
 * Mass → geometry.
 *
 * Walls are built as extruded shapes with the window openings cut out as holes,
 * so glass sits in a real reveal and casts a real shadow line. That costs more
 * geometry than laying transparent quads over a solid wall, and it is the
 * single biggest difference between a massing diagram and something that reads
 * as a building.
 *
 * Local coordinates: x along width, z along depth, y up from the mass base.
 * One unit is one foot.
 */

import * as THREE from "three";
import { glassBand, punchedLayout, skinOf, wallHeight, type Mass } from "@/domain/massing";
import { massFootprint } from "@/domain/massing";
import {
  facadeSegments,
  holeRings,
  insetRing,
  outerRing,
  type FacadeSegment,
  type Facade,
  type Point,
} from "@/domain/footprint";
import type { SkinKey } from "@/markets/types";

export interface Opening {
  /** Position along the facade run, feet from the left edge. */
  u: number;
  /** Height above the mass base, feet. */
  v: number;
  width: number;
  height: number;
}

export interface FacadeBuild {
  side: Facade;
  skin: SkinKey;
  /** Facade run length, feet. */
  length: number;
  height: number;
  openings: Opening[];
  /** World-space transform placing this facade on the mass. */
  position: THREE.Vector3;
  rotationY: number;
}

/** Thickness a wall is extruded to, so openings show a reveal. */
export const WALL_THICKNESS = 0.85;

/** Window layout for one facade, matching what the envelope takeoff measured. */
export function facadeOpenings(
  m: Mass,
  side: Facade,
  length: number,
  bandFloors: number,
  fromFloor: number,
): Opening[] {
  if (m.glz === "none" || !m.sides[side]) return [];

  const { bandH, sill } = glassBand(m);
  if (bandH <= 0) return [];

  // Ground-floor-only glazing belongs to the band that contains the ground floor.
  const floors = m.glzFloors === "ground" ? (fromFloor === 0 ? 1 : 0) : bandFloors;
  const coverage = Math.max(0, Math.min(1, (m.cov ?? 100) / 100));
  const openings: Opening[] = [];

  for (let f = 0; f < floors; f++) {
    const base = f * m.fth;

    if (m.glz === "punched") {
      const { n, pitch, start } = punchedLayout(length, m.winW, m.oc, coverage);
      for (let i = 0; i < n; i++) {
        const centre = length / 2 + start + i * pitch;
        const u = centre - m.winW / 2;
        if (u < 0.4 || u + m.winW > length - 0.4) continue;
        openings.push({ u, v: base + sill, width: m.winW, height: bandH });
      }
    } else {
      // Strip and curtain wall: one continuous band, inset from the corners.
      const inset = m.glz === "full" ? 0.4 : 1.2;
      const run = Math.max(0, length * coverage - inset * 2);
      if (run <= 0) continue;
      openings.push({ u: (length - run) / 2, v: base + sill, width: run, height: bandH });
    }
  }

  return openings;
}

/**
 * A vertical slice of the building between two setbacks.
 *
 * Without setbacks there is one band covering every floor. With them, each band
 * has its own inset ring, so upper floors are genuinely smaller and the walls,
 * the roof and the terraces all follow from the same geometry the estimate
 * measured.
 */
export interface MassBand {
  fromFloor: number;
  toFloor: number;
  /** Inset ring for this band, in plan. */
  ring: Point[];
  holes: Point[][];
  /** Height above the mass base where this band starts. */
  baseY: number;
  height: number;
  inset: number;
}

export function massBands(m: Mass): MassBand[] {
  const plan = massFootprint(m);
  const base = outerRing(plan);
  const holes = holeRings(plan);

  // Cumulative inset at each floor, then group consecutive floors that share one.
  const insetAt = (floor: number) =>
    (m.stepbacks ?? []).filter((s) => floor >= s.atFloor).reduce((a, s) => a + Math.max(0, s.inset), 0);

  const bands: MassBand[] = [];
  let start = 0;
  for (let floor = 1; floor <= m.floors; floor++) {
    const changed = floor === m.floors || insetAt(floor) !== insetAt(start);
    if (!changed) continue;
    const inset = insetAt(start);
    bands.push({
      fromFloor: start,
      toFloor: floor - 1,
      ring: inset > 0 ? insetRing(base, inset) : base,
      holes,
      baseY: start * m.fth,
      height: (floor - start) * m.fth,
      inset,
    });
    start = floor;
  }
  return bands.length ? bands : [{ fromFloor: 0, toFloor: m.floors - 1, ring: base, holes, baseY: 0, height: wallHeight(m), inset: 0 }];
}

export interface FacadeBuild {
  side: Facade;
  skin: SkinKey;
  /** Facade run length, feet. */
  length: number;
  height: number;
  /** Height above the mass base this wall starts at. */
  baseY: number;
  /** Floor index this wall's glazing starts counting from. */
  fromFloor: number;
  floors: number;
  openings: Opening[];
  /** World-space transform placing this facade on the mass. */
  position: THREE.Vector3;
  rotationY: number;
  segment: FacadeSegment;
}

/**
 * Every wall of a mass, across every band.
 *
 * Walls follow the real plan, so an L, a courtyard and a hand-drawn polygon are
 * built by the same code that builds a rectangle. A wall is placed at its
 * segment's midpoint and rotated so its outward face follows the segment
 * normal, which is the only thing that has to be right for any shape to work.
 */
export function facadeBuilds(m: Mass): FacadeBuild[] {
  const builds: FacadeBuild[] = [];

  for (const band of massBands(m)) {
    const segments = facadeSegments({ kind: "polygon", w: m.w, d: m.d, points: band.ring, holes: band.holes });
    const floors = band.toFloor - band.fromFloor + 1;

    for (const segment of segments) {
      const midX = (segment.start[0] + segment.end[0]) / 2;
      const midZ = (segment.start[1] + segment.end[1]) / 2;
      builds.push({
        side: segment.side,
        skin: skinOf(m, segment.side),
        length: segment.length,
        height: band.height,
        baseY: band.baseY,
        fromFloor: band.fromFloor,
        floors,
        openings: facadeOpenings(m, segment.side, segment.length, floors, band.fromFloor),
        position: new THREE.Vector3(midX, band.baseY, midZ),
        // atan2(nx, nz) turns the outward normal into a Y rotation, which is
        // what lets a wall sit on a diagonal edge as happily as on a cardinal one.
        rotationY: Math.atan2(segment.normal[0], segment.normal[1]),
        segment,
      });
    }
  }

  return builds;
}

/**
 * Wall geometry for one facade: a rectangle with the openings punched out,
 * extruded inward so each opening shows a reveal.
 */
export function wallGeometry(build: FacadeBuild): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const halfLen = build.length / 2;
  shape.moveTo(-halfLen, 0);
  shape.lineTo(halfLen, 0);
  shape.lineTo(halfLen, build.height);
  shape.lineTo(-halfLen, build.height);
  shape.closePath();

  for (const o of build.openings) {
    const hole = new THREE.Path();
    const x0 = o.u - halfLen;
    hole.moveTo(x0, o.v);
    hole.lineTo(x0 + o.width, o.v);
    hole.lineTo(x0 + o.width, o.v + o.height);
    hole.lineTo(x0, o.v + o.height);
    hole.closePath();
    shape.holes.push(hole);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: WALL_THICKNESS,
    bevelEnabled: false,
    curveSegments: 1,
  });
  // Extrusion runs along +z in shape space; push it inward so the outer face
  // lands exactly on the facade plane.
  geo.translate(0, 0, -WALL_THICKNESS);
  applyBoxUV(geo);
  return geo;
}

/**
 * Planar UVs in world feet, so one texture repeat covers a fixed real distance
 * regardless of how big the wall is. ExtrudeGeometry's own UVs are unusable for
 * this — they normalize to the shape bounds, which would stretch a brick course
 * across a 200-foot facade.
 */
function applyBoxUV(geo: THREE.BufferGeometry): void {
  geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const normal = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Project along whichever axis the face points down most strongly.
    if (nz >= nx && nz >= ny) {
      uv[i * 2] = x;
      uv[i * 2 + 1] = y;
    } else if (nx >= ny) {
      uv[i * 2] = z;
      uv[i * 2 + 1] = y;
    } else {
      uv[i * 2] = x;
      uv[i * 2 + 1] = z;
    }
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/** Glass plane for one opening, set back into its reveal. */
export function glassGeometry(build: FacadeBuild): THREE.BufferGeometry | null {
  if (!build.openings.length) return null;
  const halfLen = build.length / 2;
  const geometries: THREE.BufferGeometry[] = [];

  for (const o of build.openings) {
    const plane = new THREE.PlaneGeometry(o.width, o.height);
    plane.translate(o.u - halfLen + o.width / 2, o.v + o.height / 2, -WALL_THICKNESS * 0.55);
    geometries.push(plane);
  }
  return mergeGeometries(geometries);
}

/**
 * Mullion bars across a glazed band. Curtain wall and strip windows read as
 * blank mirrors without them; a vertical every few feet is what makes the
 * glazing legible as glazing.
 */
export function mullionGeometry(build: FacadeBuild, spacing = 5): THREE.BufferGeometry | null {
  if (!build.openings.length) return null;
  const halfLen = build.length / 2;
  const bar = 0.28;
  const geometries: THREE.BufferGeometry[] = [];

  for (const o of build.openings) {
    // Frame the opening.
    const edges: [number, number, number, number][] = [
      [o.u, o.v, o.width, bar],
      [o.u, o.v + o.height - bar, o.width, bar],
      [o.u, o.v, bar, o.height],
      [o.u + o.width - bar, o.v, bar, o.height],
    ];
    // Verticals inside wide bands only; a punched window is already framed.
    if (o.width > spacing * 1.5) {
      const count = Math.floor(o.width / spacing);
      const step = o.width / count;
      for (let i = 1; i < count; i++) edges.push([o.u + i * step - bar / 2, o.v, bar, o.height]);
    }

    for (const [u, v, w, h] of edges) {
      const box = new THREE.BoxGeometry(w, h, 0.3);
      box.translate(u - halfLen + w / 2, v + h / 2, -WALL_THICKNESS * 0.45);
      geometries.push(box);
    }
  }
  return mergeGeometries(geometries);
}

/**
 * Horizontal expression: a base course at grade and a slim reveal at each floor
 * line. Cheap geometry, and the single biggest step from "extruded footprint"
 * toward something that reads as a building — it gives the eye a storey count
 * and catches a shadow line all the way round.
 */
export function bandGeometry(m: Mass): { base: THREE.BufferGeometry | null; reveals: THREE.BufferGeometry | null } {
  const proud = 0.42;
  const w = m.w + proud * 2;
  const d = m.d + proud * 2;

  const baseHeight = Math.min(3.4, m.fth * 0.34);
  const base = new THREE.BoxGeometry(w, baseHeight, d);
  base.translate(0, baseHeight / 2, 0);
  applyBoxUV(base);

  // One reveal per floor line above the base, skipping grade and the parapet.
  const reveals: THREE.BufferGeometry[] = [];
  const thickness = 0.55;
  for (let floor = 1; floor < m.floors; floor++) {
    const y = floor * m.fth;
    const band = new THREE.BoxGeometry(w, thickness, d);
    band.translate(0, y, 0);
    reveals.push(band);
  }

  const merged = reveals.length ? mergeGeometries(reveals) : null;
  if (merged) applyBoxUV(merged);
  return { base, reveals: merged };
}

/** A ring (and its holes) as a THREE.Shape, for slab and roof geometry. */
function ringShape(ring: Point[], holes: Point[][]): THREE.Shape {
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, z)));
  for (const hole of holes) {
    shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, z))));
  }
  return shape;
}

/** A horizontal slab from a ring, at a given height and thickness. */
function slabFromRing(ring: Point[], holes: Point[][], y: number, thickness: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(ringShape(ring, holes), {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 1,
  });
  // Extruded in +Z in shape space; lay it flat and lift it into place.
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y + thickness, 0);
  applyBoxUV(geo);
  return geo;
}

/** A vertical band following a ring — used for parapets and cornices. */
function bandFromRing(
  ring: Point[],
  y: number,
  height: number,
  thickness: number,
  outward: number,
): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const length = Math.hypot(dx, dz);
    if (length < 0.05) continue;

    // Overlap each run by the band thickness so corners close cleanly rather
    // than leaving a notch at every vertex.
    const box = new THREE.BoxGeometry(length + thickness, height, thickness);
    const nx = dz / length;
    const nz = -dx / length;
    box.translate(0, 0, 0);
    box.rotateY(Math.atan2(nx, nz));
    box.translate((x0 + x1) / 2 + nx * outward, y + height / 2, (z0 + z1) / 2 + nz * outward);
    parts.push(box);
  }
  const merged = mergeGeometries(parts);
  if (merged) applyBoxUV(merged);
  return merged;
}

/**
 * Roof, terraces and parapets for a mass.
 *
 * With setbacks, each band gets its own roof and parapet, and the difference
 * between one band and the one below becomes a terrace — the same geometry the
 * takeoff already counted as roof area.
 */
export function roofGeometry(m: Mass): {
  roof: THREE.BufferGeometry;
  parapet: THREE.BufferGeometry | null;
} {
  const bands = massBands(m);
  const roofs: THREE.BufferGeometry[] = [];
  const parapets: THREE.BufferGeometry[] = [];

  // A pitched roof is only meaningful over a simple rectangular plan; anything
  // else gets a flat roof, which is what the estimate prices it as too.
  const pitchedAllowed = (m.shape?.kind ?? "rect") === "rect" && m.roof !== "flat" && bands.length === 1;

  if (pitchedAllowed) {
    const pitched = pitchedRoof(m);
    return { roof: pitched, parapet: null };
  }

  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    const top = band.baseY + band.height;

    if (i === bands.length - 1) {
      roofs.push(slabFromRing(band.ring, band.holes, top, 0.6));
    } else {
      // Terrace: the part of this band's roof not covered by the band above.
      const above = bands[i + 1];
      const terrace = new THREE.ExtrudeGeometry(
        (() => {
          const shape = ringShape(band.ring, band.holes);
          shape.holes.push(new THREE.Path(above.ring.map(([x, z]) => new THREE.Vector2(x, z))));
          return shape;
        })(),
        { depth: 0.6, bevelEnabled: false, curveSegments: 1 },
      );
      terrace.rotateX(-Math.PI / 2);
      terrace.translate(0, top + 0.6, 0);
      applyBoxUV(terrace);
      roofs.push(terrace);
    }

    const parapet = bandFromRing(band.ring, top, 3.2, 0.9, -0.45);
    if (parapet) parapets.push(parapet);
  }

  return {
    roof: mergeGeometries(roofs) ?? new THREE.BufferGeometry(),
    parapet: mergeGeometries(parapets),
  };
}

/** The original prism/hip roof, still used for simple rectangular plans. */
function pitchedRoof(m: Mass): THREE.BufferGeometry {
  const h = wallHeight(m);
  const alongX = m.ridge === "w";
  const across = alongX ? m.d : m.w;
  const along = alongX ? m.w : m.d;
  const rise = (across / 2) * ((m.pitch || 0) / 12);
  const ridgeHalf = m.roof === "gable" ? along / 2 : Math.max(0, (along - across) / 2);

  const v: number[] = [];
  const push = (a: number[], b: number[], c: number[]) => v.push(...a, ...b, ...c);

  const e = [
    [-along / 2, h, -across / 2],
    [along / 2, h, -across / 2],
    [along / 2, h, across / 2],
    [-along / 2, h, across / 2],
  ];
  const R0 = [-ridgeHalf, h + rise, 0];
  const R1 = [ridgeHalf, h + rise, 0];

  push(e[0], e[1], R1); push(e[0], R1, R0);
  push(e[2], e[3], R0); push(e[2], R0, R1);
  if (m.roof === "hip") {
    push(e[1], e[2], R1);
    push(e[3], e[0], R0);
  } else {
    push(e[1], e[0], R0); push(e[1], R0, R1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(v), 3));
  geo.computeVertexNormals();
  applyBoxUV(geo);
  if (!alongX) geo.rotateY(Math.PI / 2);
  return geo;
}

/**
 * Triangular gable end infill, so a pitched roof does not float over a gap.
 * Only meaningful where a pitched roof is: a simple rectangular plan.
 */
export function gableGeometry(m: Mass): THREE.BufferGeometry | null {
  if (m.roof !== "gable" || (m.shape?.kind ?? "rect") !== "rect") return null;
  const h = wallHeight(m);
  const alongX = m.ridge === "w";
  const across = alongX ? m.d : m.w;
  const along = alongX ? m.w : m.d;
  const rise = (across / 2) * ((m.pitch || 0) / 12);
  if (rise <= 0) return null;

  const build = (sign: number) => {
    const g = new THREE.BufferGeometry();
    const x = (sign * along) / 2;
    const verts = new Float32Array(
      sign > 0
        ? [x, h, -across / 2, x, h, across / 2, x, h + rise, 0]
        : [x, h, across / 2, x, h, -across / 2, x, h + rise, 0],
    );
    g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    g.computeVertexNormals();
    applyBoxUV(g);
    return g;
  };

  const merged = mergeGeometries([build(1), build(-1)]);
  if (merged && !alongX) merged.rotateY(Math.PI / 2);
  return merged;
}

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/**
 * Merge geometries that share an attribute layout.
 * Written out rather than pulled from the examples addon so the single-file
 * build has no extra module to resolve.
 */
export function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const usable = geometries.filter((g) => g.attributes.position);
  if (!usable.length) return null;
  if (usable.length === 1) return usable[0];

  // Index everything so merged buffers line up regardless of source form.
  const indexed = usable.map((g) => (g.index ? g : toIndexed(g)));
  const names = ["position", "normal", "uv"].filter((n) => indexed.every((g) => g.attributes[n]));

  const merged = new THREE.BufferGeometry();
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of indexed) {
    vertexCount += g.attributes.position.count;
    indexCount += g.index!.count;
  }

  for (const name of names) {
    const itemSize = indexed[0].attributes[name].itemSize;
    const array = new Float32Array(vertexCount * itemSize);
    let offset = 0;
    for (const g of indexed) {
      array.set(g.attributes[name].array as Float32Array, offset);
      offset += g.attributes[name].count * itemSize;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }

  const indices = new Uint32Array(indexCount);
  let indexOffset = 0;
  let vertexOffset = 0;
  for (const g of indexed) {
    const src = g.index!;
    for (let i = 0; i < src.count; i++) indices[indexOffset + i] = src.getX(i) + vertexOffset;
    indexOffset += src.count;
    vertexOffset += g.attributes.position.count;
  }
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

function toIndexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const count = g.attributes.position.count;
  const index = new Uint32Array(count);
  for (let i = 0; i < count; i++) index[i] = i;
  const clone = g.clone();
  clone.setIndex(new THREE.BufferAttribute(index, 1));
  return clone;
}
