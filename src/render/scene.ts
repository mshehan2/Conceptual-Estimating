/**
 * Scene assembly.
 *
 * Turns a scheme into a three.js scene graph: ground, buildings, site paving,
 * entourage. Rebuilt whenever the scheme changes — conceptual models are small
 * enough that a full rebuild is simpler and less bug-prone than diffing, and it
 * guarantees the picture always matches the model the estimate priced.
 */

import * as THREE from "three";
import type { Scheme } from "@/domain/project";
import { wallHeight, type Mass } from "@/domain/massing";
import { TYPE_BY_ID, MARKET_BY_ID } from "@/markets/registry";
import { buildEntourage, type EntourageResult } from "./entourage";
import {
  contextMaterial,
  glassMaterial,
  groundMaterial,
  mullionMaterial,
  pavingMaterial,
  roofMaterial,
  scaledWallMaterial,
  trimMaterial,
  type RenderMode,
} from "./materials";
import {
  bandGeometry,
  facadeBuilds,
  gableGeometry,
  glassGeometry,
  mullionGeometry,
  roofGeometry,
  wallGeometry,
} from "./massGeometry";

export interface SceneBuild {
  group: THREE.Group;
  bounds: THREE.Box3;
  /** Every mesh keyed by mass id, for picking and highlight. */
  massMeshes: Map<string, THREE.Object3D>;
  dispose: () => void;
}

export interface SceneOptions {
  mode: RenderMode;
  showEntourage: boolean;
  showGround: boolean;
  /** Highlighted mass id, drawn with an outline. */
  selectedMassId?: string | null;
}

/** Colour a mass takes in program mode: its market's accent. */
function programTint(mass: Mass): number {
  const type = TYPE_BY_ID[mass.typeId];
  const market = type ? MARKET_BY_ID[type.marketId] : undefined;
  return market ? Number.parseInt(market.color.replace("#", ""), 16) : 0x9aa4ad;
}

/** Build one mass: four walls with punched openings, glass, mullions, roof. */
function buildMass(mass: Mass, options: SceneOptions, disposables: THREE.BufferGeometry[]): THREE.Group {
  const group = new THREE.Group();
  group.name = `mass:${mass.id}`;

  const mode: RenderMode = mass.context ? "clay" : options.mode;
  const tint = programTint(mass);

  for (const build of facadeBuilds(mass)) {
    const wall = wallGeometry(build);
    disposables.push(wall);
    const wallMesh = new THREE.Mesh(
      wall,
      mass.context ? contextMaterial() : scaledWallMaterial(build.skin, mode, tint),
    );
    wallMesh.position.copy(build.position);
    wallMesh.rotation.y = build.rotationY;
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    group.add(wallMesh);

    if (!mass.context) {
      const glass = glassGeometry(build);
      if (glass) {
        disposables.push(glass);
        const glassMesh = new THREE.Mesh(glass, glassMaterial(mode));
        glassMesh.position.copy(build.position);
        glassMesh.rotation.y = build.rotationY;
        glassMesh.receiveShadow = false;
        group.add(glassMesh);
      }

      const mullions = mullionGeometry(build, mass.glz === "full" ? 5 : 6);
      if (mullions) {
        disposables.push(mullions);
        const mullionMesh = new THREE.Mesh(mullions, mullionMaterial(mode));
        mullionMesh.position.copy(build.position);
        mullionMesh.rotation.y = build.rotationY;
        mullionMesh.castShadow = true;
        group.add(mullionMesh);
      }
    }
  }

  // Base course and floor-line reveals, before the roof so they sit under it.
  const bands = bandGeometry(mass);
  for (const geometry of [bands.base, bands.reveals]) {
    if (!geometry) continue;
    disposables.push(geometry);
    const bandMesh = new THREE.Mesh(geometry, mass.context ? contextMaterial() : trimMaterial(mode, tint));
    bandMesh.castShadow = true;
    bandMesh.receiveShadow = true;
    group.add(bandMesh);
  }

  const { roof, parapet } = roofGeometry(mass);
  disposables.push(roof);
  const roofMesh = new THREE.Mesh(
    roof,
    mass.context ? contextMaterial() : roofMaterial(mode, mass.roof !== "flat"),
  );
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  group.add(roofMesh);

  if (parapet) {
    disposables.push(parapet);
    const parapetMesh = new THREE.Mesh(
      parapet,
      mass.context ? contextMaterial() : scaledWallMaterial(mass.skin, mode, tint),
    );
    parapetMesh.castShadow = true;
    parapetMesh.receiveShadow = true;
    group.add(parapetMesh);
  }

  const gable = gableGeometry(mass);
  if (gable) {
    disposables.push(gable);
    const gableMesh = new THREE.Mesh(
      gable,
      mass.context ? contextMaterial() : scaledWallMaterial(mass.skin, mode, tint),
    );
    gableMesh.castShadow = true;
    gableMesh.receiveShadow = true;
    group.add(gableMesh);
  }

  group.position.set(mass.x, mass.baseElev, mass.z);
  group.rotation.y = (-mass.rot * Math.PI) / 180;
  return group;
}

export function buildSchemeScene(scheme: Scheme, options: SceneOptions): SceneBuild {
  const group = new THREE.Group();
  const disposables: THREE.BufferGeometry[] = [];
  const massMeshes = new Map<string, THREE.Object3D>();

  const bounds = new THREE.Box3();
  const exclusions: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];

  for (const mass of scheme.masses) {
    const built = buildMass(mass, options, disposables);
    group.add(built);
    massMeshes.set(mass.id, built);

    // Bounds from the footprint rather than the geometry: cheaper and exact
    // enough for camera framing and entourage placement.
    const halfDiagonal = Math.hypot(mass.w, mass.d) / 2;
    const box = {
      minX: mass.x - halfDiagonal,
      maxX: mass.x + halfDiagonal,
      minZ: mass.z - halfDiagonal,
      maxZ: mass.z + halfDiagonal,
    };
    exclusions.push(box);
    bounds.expandByPoint(new THREE.Vector3(box.minX, 0, box.minZ));
    bounds.expandByPoint(new THREE.Vector3(box.maxX, wallHeight(mass) + mass.baseElev, box.maxZ));
  }

  if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(200, 40, 200));

  // --- Ground ---
  if (options.showGround) {
    const size = Math.max(3000, bounds.getSize(new THREE.Vector3()).length() * 8);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), groundMaterial(options.mode));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.12;
    ground.receiveShadow = true;
    group.add(ground);
    disposables.push(ground.geometry);
  }

  // --- Site paving, sized from the scheme's parking area ---
  if (scheme.site.parking > 0) {
    const centre = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const depth = Math.max(90, Math.sqrt(scheme.site.parking) * 0.75);
    const width = Math.max(120, scheme.site.parking / depth);
    const paving = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), pavingMaterial(options.mode));
    paving.rotation.x = -Math.PI / 2;
    paving.position.set(centre.x, -0.06, bounds.max.z + depth / 2 + 40);
    paving.receiveShadow = true;
    group.add(paving);
    disposables.push(paving.geometry);
    void size;
  }

  // --- Entourage ---
  let entourage: EntourageResult | null = null;
  if (options.showEntourage) {
    const span = bounds.getSize(new THREE.Vector3());
    const area = Math.max(1, span.x * span.z);
    entourage = buildEntourage(
      {
        bounds: { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z },
        exclusions,
        // Scale the population to the site so a small building is not buried
        // in a forest and a large one does not sit in an empty field.
        trees: Math.round(Math.min(120, 14 + area / 9000)),
        cars: Math.round(Math.min(70, 6 + scheme.site.parking / 900)),
        people: Math.round(Math.min(40, 5 + area / 26000)),
        seed: hashString(scheme.id),
      },
      options.mode,
    );
    group.add(entourage.group);
  }

  return {
    group,
    bounds,
    massMeshes,
    dispose: () => {
      for (const g of disposables) g.dispose();
      entourage?.dispose();
    },
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
