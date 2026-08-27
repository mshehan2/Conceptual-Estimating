/**
 * Entourage: trees, cars, and figures.
 *
 * Scale reference is the whole job. A bare massing model gives the eye nothing
 * to measure against, so a six-storey building and a two-storey building look
 * the same. One car in the foreground fixes that instantly.
 *
 * Everything is instanced from a handful of low-poly prototypes and placed
 * deterministically, so a given scheme always renders the same scene.
 */

import * as THREE from "three";
import { mergeGeometries } from "./massGeometry";
import type { RenderMode } from "./materials";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = Math.imul(a ^ (a >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Prototypes
// ---------------------------------------------------------------------------

/** A deciduous tree: tapered trunk and three offset canopy masses. */
function treeGeometries(): { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.42, 0.68, 9, 7);
  trunk.translate(0, 4.5, 0);

  const blobs: THREE.BufferGeometry[] = [];
  const spec: [number, number, number, number][] = [
    [7.2, 0, 13.5, 0],
    [5.4, -3.4, 11.2, 1.8],
    [4.8, 3.1, 11.8, -2.1],
  ];
  for (const [r, x, y, z] of spec) {
    const b = new THREE.IcosahedronGeometry(r, 1);
    b.translate(x, y, z);
    blobs.push(b);
  }
  return { trunk, canopy: mergeGeometries(blobs)! };
}

/** A generic car: body, cabin, four wheels. Reads correctly from 40 feet up. */
function carGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.BoxGeometry(6.2, 2.1, 15.2);
  body.translate(0, 2.05, 0);
  parts.push(body);

  const cabin = new THREE.BoxGeometry(5.5, 1.8, 7.4);
  cabin.translate(0, 3.9, -0.6);
  parts.push(cabin);

  for (const [x, z] of [[-2.7, 4.6], [2.7, 4.6], [-2.7, -4.6], [2.7, -4.6]] as const) {
    const w = new THREE.CylinderGeometry(1.15, 1.15, 0.8, 10);
    w.rotateZ(Math.PI / 2);
    w.translate(x, 1.15, z);
    parts.push(w);
  }
  return mergeGeometries(parts)!;
}

/** A standing figure at 5'-9": legs, torso, head. */
function personGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const legs = new THREE.CylinderGeometry(0.52, 0.42, 2.9, 7);
  legs.translate(0, 1.45, 0);
  parts.push(legs);
  const torso = new THREE.CylinderGeometry(0.66, 0.56, 2.1, 7);
  torso.translate(0, 3.95, 0);
  parts.push(torso);
  const head = new THREE.SphereGeometry(0.44, 8, 6);
  head.translate(0, 5.35, 0);
  parts.push(head);
  return mergeGeometries(parts)!;
}

// ---------------------------------------------------------------------------
// Placement
//
// Entourage placed at random reads as noise, and noise is worse than nothing:
// cars sitting on lawns and trees in a uniform confetti tell a client the model
// was not thought about. Everything below is placed the way a site plan places
// it — cars in marked stalls, trees screening the lot and lining the approach,
// people between the parking and the door.
// ---------------------------------------------------------------------------

export interface Rect {
  cx: number;
  cz: number;
  width: number;
  depth: number;
  /** Radians about Y. */
  rot: number;
}

export interface Placed {
  x: number;
  z: number;
  /** Heading, radians about Y. */
  angle: number;
}

/** Dimensions of a standard 90° surface lot, feet. */
export const STALL_W = 9;
export const STALL_D = 18;
export const AISLE_W = 24;
export const LOT_SETBACK = 8;
/** Stalls between landscape islands — most codes land between 10 and 15. */
export const STALLS_PER_ISLAND = 11;

const rot = (x: number, z: number, a: number): [number, number] =>
  a === 0 ? [x, z] : [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];

const toWorld = (lot: Rect, lx: number, lz: number): [number, number] => {
  const [x, z] = rot(lx, lz, lot.rot);
  return [lot.cx + x, lot.cz + z];
};

const dist2 = (ax: number, az: number, bx: number, bz: number) =>
  (ax - bx) ** 2 + (az - bz) ** 2;

export interface ParkingLayout {
  /** Every stall, ordered nearest the building first — lots fill from the door. */
  stalls: Placed[];
  /** Landscape islands broken into the stall runs. */
  islands: { x: number; z: number }[];
  /** Centre of each drive aisle, for the walk from car to door. */
  aisles: { x: number; z: number }[];
}

/**
 * Lay a surface lot out properly: 9×18 stalls in double-loaded bays either
 * side of a 24ft aisle, with a landscape island every eleventh stall.
 */
export function parkingLayout(lot: Rect, toward: { x: number; z: number }): ParkingLayout {
  const stalls: Placed[] = [];
  const islands: { x: number; z: number }[] = [];
  const aisles: { x: number; z: number }[] = [];

  const usableW = lot.width - 2 * LOT_SETBACK;
  const usableD = lot.depth - 2 * LOT_SETBACK;
  const bay = STALL_D * 2 + AISLE_W;
  if (usableW < STALL_W * 2 || usableD < STALL_D + AISLE_W) return { stalls, islands, aisles };

  // Rows run across the width; bays stack across the depth.
  const rows: { lz: number; flip: boolean }[] = [];
  let edge = -usableD / 2;
  while (usableD / 2 - edge >= bay) {
    rows.push({ lz: edge + STALL_D / 2, flip: false });
    aisles.push({ x: 0, z: edge + STALL_D + AISLE_W / 2 });
    rows.push({ lz: edge + STALL_D + AISLE_W + STALL_D / 2, flip: true });
    edge += bay;
  }
  // A single-loaded row in whatever depth is left over, rather than wasting it.
  if (usableD / 2 - edge >= STALL_D + AISLE_W) {
    rows.push({ lz: edge + STALL_D / 2, flip: false });
    aisles.push({ x: 0, z: edge + STALL_D + AISLE_W / 2 });
  }

  const perRow = Math.floor(usableW / STALL_W);
  const x0 = -(perRow * STALL_W) / 2 + STALL_W / 2;

  for (const row of rows) {
    for (let i = 0; i < perRow; i++) {
      const lx = x0 + i * STALL_W;
      const [x, z] = toWorld(lot, lx, row.lz);
      if (i % STALLS_PER_ISLAND === STALLS_PER_ISLAND - 1) {
        islands.push({ x, z });
        continue;
      }
      stalls.push({ x, z, angle: lot.rot + (row.flip ? Math.PI : 0) });
    }
  }

  for (const a of aisles) {
    const [x, z] = toWorld(lot, a.x, a.z);
    a.x = x;
    a.z = z;
  }

  // Lots fill from the entrance out, so the empty stalls are the far ones.
  stalls.sort((a, b) => dist2(a.x, a.z, toward.x, toward.z) - dist2(b.x, b.z, toward.x, toward.z));
  return { stalls, islands, aisles };
}

/** Points spaced evenly along one edge of a rectangle, pushed `offset` outward. */
function alongEdge(
  rect: Rect,
  edge: "n" | "s" | "e" | "w",
  spacing: number,
  offset: number,
  inset = 0,
): { x: number; z: number }[] {
  const horizontal = edge === "n" || edge === "s";
  const run = (horizontal ? rect.width : rect.depth) - inset * 2;
  if (run < spacing) return [];
  const n = Math.max(1, Math.round(run / spacing));
  const half = (horizontal ? rect.depth : rect.width) / 2;
  const sign = edge === "n" || edge === "e" ? 1 : -1;
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -run / 2 + (i * run) / n;
    const [lx, lz] = horizontal ? [t, sign * (half + offset)] : [sign * (half + offset), t];
    const [x, z] = toWorld(rect, lx, lz);
    out.push({ x, z });
  }
  return out;
}

export interface EntourageInput {
  /** Bounding box of the built scope, world feet. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Rectangles nothing may be placed inside — the buildings. */
  exclusions: { minX: number; maxX: number; minZ: number; maxZ: number }[];
  /** The surface lot, if the scheme has one. Cars belong in it. */
  lot?: Rect;
  /** The primary building, for the approach frontage and the entrance. */
  building?: Rect;
  trees: number;
  cars: number;
  people: number;
  seed?: number;
}

const inside = (x: number, z: number, r: EntourageInput["exclusions"][number], pad = 0) =>
  x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;

/**
 * The door people arrive at: the point on the building nearest the lot. It is
 * an approximation of an entrance, but it is the right approximation — it is
 * where a site plan would put one.
 */
export function entrancePoint(input: EntourageInput): { x: number; z: number } {
  const b = input.building;
  const cx = (input.bounds.minX + input.bounds.maxX) / 2;
  const cz = (input.bounds.minZ + input.bounds.maxZ) / 2;
  if (!b) return { x: cx, z: cz };
  if (!input.lot) return { x: b.cx, z: b.cz + b.depth / 2 };
  const dx = input.lot.cx - b.cx;
  const dz = input.lot.cz - b.cz;
  return Math.abs(dx) > Math.abs(dz)
    ? { x: b.cx + Math.sign(dx) * (b.width / 2), z: b.cz }
    : { x: b.cx, z: b.cz + Math.sign(dz) * (b.depth / 2) };
}

/**
 * Fill the remaining tree budget in a band at the site edge.
 *
 * Following an offset RECTANGLE, not a ring: a ring reads as a visible arc of
 * trees curving through open ground, which is the one thing no real site has.
 * An offset rectangle reads as a property line, which is what it is.
 */
function perimeterBand(
  input: EntourageInput,
  count: number,
  taken: { x: number; z: number }[],
  minGap: number,
  rnd: () => number,
): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  if (count <= 0) return out;

  const margin = 90;
  const line = {
    minX: input.bounds.minX - margin,
    maxX: input.bounds.maxX + margin,
    minZ: input.bounds.minZ - margin,
    maxZ: input.bounds.maxZ + margin,
  };
  const w = line.maxX - line.minX;
  const d = line.maxZ - line.minZ;
  const perimeter = 2 * (w + d);
  const spacing = Math.max(26, perimeter / Math.max(1, count));
  const gap2 = minGap * minGap;

  for (let t = 0; t < perimeter && out.length < count; t += spacing) {
    // Walk the rectangle, corner to corner.
    let x: number;
    let z: number;
    if (t < w) [x, z] = [line.minX + t, line.minZ];
    else if (t < w + d) [x, z] = [line.maxX, line.minZ + (t - w)];
    else if (t < 2 * w + d) [x, z] = [line.maxX - (t - w - d), line.maxZ];
    else [x, z] = [line.minX, line.maxZ - (t - 2 * w - d)];

    // Enough wander that it is a planted edge rather than a fence of trees.
    x += (rnd() - 0.5) * spacing * 0.7;
    z += (rnd() - 0.5) * spacing * 0.7;
    const inward = rnd() * 46 - 8;
    x += x < (line.minX + line.maxX) / 2 ? inward : -inward;
    z += z < (line.minZ + line.maxZ) / 2 ? inward : -inward;

    if (input.exclusions.some((e) => inside(x, z, e, 24))) continue;
    if (input.lot && insideRect(input.lot, x, z, 10)) continue;
    if ([...taken, ...out].some((p) => dist2(p.x, p.z, x, z) < gap2)) continue;
    out.push({ x, z });
  }
  return out;
}

const insideRect = (r: Rect, x: number, z: number, pad = 0) => {
  const [lx, lz] = rot(x - r.cx, z - r.cz, -r.rot);
  return Math.abs(lx) < r.width / 2 + pad && Math.abs(lz) < r.depth / 2 + pad;
};

/**
 * Where the trees go, the way a landscape plan decides it: islands in the lot,
 * a screen around the lot, street trees along the building frontage, then a
 * perimeter band at the site edge.
 *
 * Each source gets a share of the budget rather than being served in order.
 * First-come-first-served looks reasonable in code and produces a lot ringed
 * by every tree on the site while the building stands in a bare field.
 */
export function treePlan(
  input: EntourageInput,
  layout: ParkingLayout,
  rnd: () => number,
): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const clear = (p: { x: number; z: number }) =>
    !input.exclusions.some((e) => inside(p.x, p.z, e, 18));

  /** Take up to `cap` of these, thinning evenly rather than truncating. */
  const take = (points: { x: number; z: number }[], cap: number) => {
    const usable = points.filter(clear);
    const room = Math.min(cap, input.trees - out.length);
    if (room <= 0 || usable.length === 0) return;
    const step = Math.max(1, usable.length / room);
    for (let i = 0; out.length < input.trees && i < usable.length; i += step) {
      out.push(usable[Math.floor(i)]);
    }
  };

  const budget = input.trees;
  take(layout.islands, Math.round(budget * 0.3));

  if (input.lot) {
    // Screen the lot on the outside — the edge facing the building is where
    // the drive and the walk come in, so it is left open.
    const door = entrancePoint(input);
    const edges = (["n", "s", "e", "w"] as const).filter((edge) => {
      const mid = alongEdge(input.lot!, edge, 1e9, 0);
      return mid.length === 0 || dist2(mid[0].x, mid[0].z, door.x, door.z) > (input.lot!.depth / 2) ** 2;
    });
    take(edges.flatMap((e) => alongEdge(input.lot!, e, 34, 14)), Math.round(budget * 0.25));
  }

  if (input.building) {
    take(
      (["n", "s", "e", "w"] as const).flatMap((e) => alongEdge(input.building!, e, 30, 34, 20)),
      Math.round(budget * 0.3),
    );
  }

  take(perimeterBand(input, budget - out.length, out, 26, rnd), budget);
  return out.slice(0, budget);
}

/** People between the parking and the door, which is where people actually are. */
export function peoplePlan(
  input: EntourageInput,
  layout: ParkingLayout,
  rnd: () => number,
): { x: number; z: number }[] {
  const door = entrancePoint(input);
  const out: { x: number; z: number }[] = [];

  // A cluster at the entrance.
  const atDoor = Math.max(2, Math.round(input.people * 0.45));
  for (let i = 0; i < atDoor && out.length < input.people; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 14 + rnd() * 34;
    out.push({ x: door.x + Math.cos(a) * r, z: door.z + Math.sin(a) * r });
  }

  // The rest walking in from the aisles.
  const from = layout.aisles.length ? layout.aisles : [door];
  let i = 0;
  while (out.length < input.people) {
    const a = from[i % from.length];
    const t = 0.15 + rnd() * 0.7;
    out.push({
      x: a.x + (door.x - a.x) * t + (rnd() - 0.5) * 16,
      z: a.z + (door.z - a.z) * t + (rnd() - 0.5) * 16,
    });
    i++;
    if (i > input.people * 4) break;
  }
  return out.slice(0, input.people);
}

/**
 * Cars with nowhere to park line the frontage instead of standing on the lawn.
 */
export function streetParking(input: EntourageInput, count: number): Placed[] {
  const b = input.building;
  if (!b) return [];
  const out: Placed[] = [];
  const spacing = 22;
  for (const edge of ["s", "n"] as const) {
    for (const p of alongEdge(b, edge, spacing, 70, 10)) {
      if (out.length >= count) break;
      if (input.lot && insideRect(input.lot, p.x, p.z, 6)) continue;
      out.push({ x: p.x, z: p.z, angle: b.rot + Math.PI / 2 });
    }
  }
  return out.slice(0, count);
}

export interface EntourageResult {
  group: THREE.Group;
  dispose: () => void;
}

export function buildEntourage(input: EntourageInput, mode: RenderMode): EntourageResult {
  const group = new THREE.Group();
  group.name = "entourage";
  const rnd = rng(input.seed ?? 20260827);
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  const clay = mode === "clay";
  const trunkMat = new THREE.MeshStandardMaterial({ color: clay ? 0xd8d5ce : 0x5b4a3a, roughness: 0.95 });
  const canopyMat = new THREE.MeshStandardMaterial({
    color: clay ? 0xe4e1da : 0x5c7a4a,
    roughness: 0.92,
    flatShading: true,
  });
  const carBodyMat = new THREE.MeshStandardMaterial({
    color: clay ? 0xdcd9d2 : 0xb8bcc0,
    roughness: 0.32,
    metalness: 0.55,
  });
  const personMat = new THREE.MeshStandardMaterial({ color: clay ? 0xdcd9d2 : 0x6f7480, roughness: 0.85 });
  disposables.push(trunkMat, canopyMat, carBodyMat, personMat);

  const door = entrancePoint(input);
  const layout = input.lot
    ? parkingLayout(input.lot, door)
    : { stalls: [] as Placed[], islands: [], aisles: [] };

  // --- Trees ---
  if (input.trees > 0) {
    const { trunk, canopy } = treeGeometries();
    disposables.push(trunk, canopy);
    const spots = treePlan(input, layout, rnd);
    const trunks = new THREE.InstancedMesh(trunk, trunkMat, spots.length);
    const canopies = new THREE.InstancedMesh(canopy, canopyMat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(({ x, z }, i) => {
      // Enough variation that a row does not look stamped, not so much that
      // two neighbours read as different species.
      const scale = 0.82 + rnd() * 0.4;
      m.compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2),
        new THREE.Vector3(scale, scale * (0.9 + rnd() * 0.25), scale),
      );
      trunks.setMatrixAt(i, m);
      canopies.setMatrixAt(i, m);
    });
    trunks.castShadow = canopies.castShadow = true;
    canopies.receiveShadow = true;
    trunks.userData.maskCategory = "vegetation";
    canopies.userData.maskCategory = "vegetation";
    group.add(trunks, canopies);
  }

  // --- Cars ---
  if (input.cars > 0) {
    const car = carGeometry();
    disposables.push(car);
    // Stalls first, nearest the door; anything left over parks on the street
    // rather than standing on the grass.
    const parked = layout.stalls.slice(0, input.cars);
    const spots =
      parked.length >= input.cars
        ? parked
        : [...parked, ...streetParking(input, input.cars - parked.length)];
    const cars = new THREE.InstancedMesh(car, carBodyMat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(({ x, z, angle }, i) => {
      // A few degrees of slop, because nobody parks perfectly square.
      const skew = (rnd() - 0.5) * 0.06;
      m.compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle + skew),
        new THREE.Vector3(1, 1, 1),
      );
      cars.setMatrixAt(i, m);
    });
    cars.castShadow = true;
    cars.userData.maskCategory = "vehicle";
    group.add(cars);
  }

  // --- People ---
  if (input.people > 0) {
    const person = personGeometry();
    disposables.push(person);
    const spots = peoplePlan(input, layout, rnd);
    const people = new THREE.InstancedMesh(person, personMat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(({ x, z }, i) => {
      const scale = 0.94 + rnd() * 0.12;
      m.compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2),
        new THREE.Vector3(scale, scale, scale),
      );
      people.setMatrixAt(i, m);
    });
    people.castShadow = true;
    people.userData.maskCategory = "figure";
    group.add(people);
  }

  return {
    group,
    dispose: () => {
      for (const d of disposables) d.dispose();
      group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
    },
  };
}
