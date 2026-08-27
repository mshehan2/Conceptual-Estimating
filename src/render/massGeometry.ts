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
import { FACADES, glassBand, punchedLayout, skinOf, wallHeight, type Facade, type Mass } from "@/domain/massing";
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
export function facadeOpenings(m: Mass, side: Facade): Opening[] {
  if (m.glz === "none" || !m.sides[side]) return [];

  const length = side === "f" || side === "b" ? m.w : m.d;
  const { bandH, sill } = glassBand(m);
  if (bandH <= 0) return [];

  const floors = m.glzFloors === "ground" ? 1 : m.floors;
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

/** The four facades of a mass, with their openings and placement. */
export function facadeBuilds(m: Mass): FacadeBuild[] {
  const h = wallHeight(m);
  const hw = m.w / 2;
  const hd = m.d / 2;

  // Each facade is authored as a flat panel in its own local frame, then
  // rotated into place. Front faces +z, back -z, left -x, right +x.
  const placement: Record<Facade, { position: THREE.Vector3; rotationY: number; length: number }> = {
    f: { position: new THREE.Vector3(0, 0, hd), rotationY: 0, length: m.w },
    b: { position: new THREE.Vector3(0, 0, -hd), rotationY: Math.PI, length: m.w },
    l: { position: new THREE.Vector3(-hw, 0, 0), rotationY: -Math.PI / 2, length: m.d },
    r: { position: new THREE.Vector3(hw, 0, 0), rotationY: Math.PI / 2, length: m.d },
  };

  return FACADES.map((side) => ({
    side,
    skin: skinOf(m, side),
    length: placement[side].length,
    height: h,
    openings: facadeOpenings(m, side),
    position: placement[side].position,
    rotationY: placement[side].rotationY,
  }));
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

/** Roof and parapet for a mass, in local coordinates. */
export function roofGeometry(m: Mass): { roof: THREE.BufferGeometry; parapet: THREE.BufferGeometry | null } {
  const h = wallHeight(m);

  if (m.roof === "flat") {
    const roof = new THREE.BoxGeometry(m.w, 0.6, m.d);
    roof.translate(0, h + 0.3, 0);
    applyBoxUV(roof);

    // A parapet is what stops a flat roof reading as a sliced-off box.
    const height = 3.2;
    const t = 0.9;
    const parts = [
      boxAt(m.w, height, t, 0, h + height / 2, m.d / 2 - t / 2),
      boxAt(m.w, height, t, 0, h + height / 2, -m.d / 2 + t / 2),
      boxAt(t, height, m.d - t * 2, -m.w / 2 + t / 2, h + height / 2, 0),
      boxAt(t, height, m.d - t * 2, m.w / 2 - t / 2, h + height / 2, 0),
    ];
    const parapet = mergeGeometries(parts);
    if (parapet) applyBoxUV(parapet);
    return { roof, parapet };
  }

  // Pitched: a prism along the ridge for a gable, a true hip for a hip roof.
  const alongX = m.ridge === "w";
  const across = alongX ? m.d : m.w;
  const along = alongX ? m.w : m.d;
  const rise = (across / 2) * ((m.pitch || 0) / 12);
  const ridgeHalf = m.roof === "gable" ? along / 2 : Math.max(0, (along - across) / 2);

  const v: number[] = [];
  const push = (a: number[], b: number[], c: number[]) => v.push(...a, ...b, ...c);

  // Eave corners and ridge ends, in a frame where the ridge runs along x.
  const e = [
    [-along / 2, h, -across / 2],
    [along / 2, h, -across / 2],
    [along / 2, h, across / 2],
    [-along / 2, h, across / 2],
  ];
  const r0 = [-ridgeHalf, h + rise, 0];
  const r1 = [ridgeHalf, h + rise, 0];

  push(e[0], e[1], r1); push(e[0], r1, r0);          // back slope
  push(e[2], e[3], r0); push(e[2], r0, r1);          // front slope
  if (m.roof === "hip") {
    push(e[1], e[2], r1);                             // right hip
    push(e[3], e[0], r0);                             // left hip
  } else {
    push(e[1], e[0], r0); push(e[1], r0, r1);        // gable ends handled by wall
  }

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(v);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  applyBoxUV(geo);
  if (!alongX) geo.rotateY(Math.PI / 2);

  return { roof: geo, parapet: null };
}

/** Triangular gable end infill, so a pitched roof does not float over a gap. */
export function gableGeometry(m: Mass): THREE.BufferGeometry | null {
  if (m.roof !== "gable") return null;
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
