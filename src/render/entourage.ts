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
// ---------------------------------------------------------------------------

export interface EntourageInput {
  /** Bounding box of the built scope, world feet. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Rectangles nothing may be placed inside — the buildings. */
  exclusions: { minX: number; maxX: number; minZ: number; maxZ: number }[];
  trees: number;
  cars: number;
  people: number;
  seed?: number;
}

const inside = (x: number, z: number, r: EntourageInput["exclusions"][number], pad = 0) =>
  x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;

/** Scatter points in a ring around the scope, avoiding the buildings. */
function scatter(input: EntourageInput, count: number, pad: number, spread: number, rnd: () => number) {
  const points: [number, number][] = [];
  const cx = (input.bounds.minX + input.bounds.maxX) / 2;
  const cz = (input.bounds.minZ + input.bounds.maxZ) / 2;
  const rx = (input.bounds.maxX - input.bounds.minX) / 2 + spread;
  const rz = (input.bounds.maxZ - input.bounds.minZ) / 2 + spread;

  let guard = count * 40;
  while (points.length < count && guard-- > 0) {
    const x = cx + (rnd() * 2 - 1) * rx;
    const z = cz + (rnd() * 2 - 1) * rz;
    if (input.exclusions.some((r) => inside(x, z, r, pad))) continue;
    points.push([x, z]);
  }
  return points;
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

  // --- Trees ---
  if (input.trees > 0) {
    const { trunk, canopy } = treeGeometries();
    disposables.push(trunk, canopy);
    const spots = scatter(input, input.trees, 22, 130, rnd);
    const trunks = new THREE.InstancedMesh(trunk, trunkMat, spots.length);
    const canopies = new THREE.InstancedMesh(canopy, canopyMat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z], i) => {
      const scale = 0.68 + rnd() * 0.75;
      m.compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2),
        new THREE.Vector3(scale, scale * (0.85 + rnd() * 0.4), scale),
      );
      trunks.setMatrixAt(i, m);
      canopies.setMatrixAt(i, m);
    });
    trunks.castShadow = canopies.castShadow = true;
    canopies.receiveShadow = true;
    group.add(trunks, canopies);
  }

  // --- Cars ---
  if (input.cars > 0) {
    const car = carGeometry();
    disposables.push(car);
    const spots = scatter(input, input.cars, 16, 95, rnd);
    const cars = new THREE.InstancedMesh(car, carBodyMat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z], i) => {
      // Cars line up with the grid rather than pointing at random angles.
      const angle = (Math.floor(rnd() * 4) * Math.PI) / 2 + (rnd() - 0.5) * 0.1;
      m.compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
        new THREE.Vector3(1, 1, 1),
      );
      cars.setMatrixAt(i, m);
    });
    cars.castShadow = true;
    group.add(cars);
  }

  // --- People ---
  if (input.people > 0) {
    const person = personGeometry();
    disposables.push(person);
    const spots = scatter(input, input.people, 8, 60, rnd);
    const people = new THREE.InstancedMesh(person, personMat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z], i) => {
      const scale = 0.94 + rnd() * 0.12;
      m.compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2),
        new THREE.Vector3(scale, scale, scale),
      );
      people.setMatrixAt(i, m);
    });
    people.castShadow = true;
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
