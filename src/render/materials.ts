/**
 * Material library.
 *
 * Two render modes share one geometry: `realistic` uses the procedural PBR
 * skins, `clay` replaces everything with a neutral white model for review.
 * `program` colours masses by their building type, which is the diagram mode
 * the massing work is actually done in.
 */

import * as THREE from "three";
import type { SkinKey } from "@/markets/types";
import type { RoofAssembly } from "@/domain/massing";
import { skinTextures } from "./textures";

export type RenderMode = "realistic" | "clay" | "program";

const CLAY = 0xe8e5df;
const CLAY_ROOF = 0xdad6cf;

const cache = new Map<string, THREE.Material>();

const remember = <T extends THREE.Material>(key: string, make: () => T): T => {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const made = make();
  cache.set(key, made);
  return made;
};

/** Wall material for a skin, with UV repeat set from the wall's real size. */
export function wallMaterial(skin: SkinKey, mode: RenderMode, tint?: number): THREE.Material {
  if (mode === "clay") {
    return remember("clay-wall", () => new THREE.MeshStandardMaterial({ color: CLAY, roughness: 0.92, metalness: 0 }));
  }
  if (mode === "program") {
    const color = tint ?? 0x9aa4ad;
    return remember(`program-wall-${color}`, () =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, flatShading: false }),
    );
  }

  return remember(`skin-${skin}`, () => {
    const tex = skinTextures(skin);
    return new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normalMap,
      roughnessMap: tex.roughnessMap,
      normalScale: new THREE.Vector2(tex.normalScale, tex.normalScale),
      roughness: tex.roughness,
      metalness: tex.metalness,
      envMapIntensity: 1,
    });
  });
}

/**
 * Set the UV repeat on a wall material clone so texture scale is in real feet.
 * Materials are shared, so this returns a per-mesh clone when the repeat is
 * different from the cached one.
 */
export function scaledWallMaterial(
  skin: SkinKey,
  mode: RenderMode,
  tint?: number,
): THREE.Material {
  const base = wallMaterial(skin, mode, tint);
  if (mode !== "realistic") return base;

  // The UV layout is already in world feet, so the repeat is a straight
  // division: 1 / tileFeet makes one texture cover `tileFeet` of wall.
  const tex = skinTextures(skin);
  const r = 1 / tex.tileFeet;
  for (const map of [tex.map, tex.normalMap, tex.roughnessMap]) {
    map.repeat.set(r, r);
    map.needsUpdate = true;
  }
  return base;
}

/** Vision glass. Physical material so it takes a real reflection off the sky. */
export function glassMaterial(mode: RenderMode): THREE.Material {
  if (mode === "clay") {
    return remember("clay-glass", () =>
      new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.35, metalness: 0.1 }),
    );
  }
  if (mode === "program") {
    return remember("program-glass", () =>
      new THREE.MeshStandardMaterial({ color: 0x9fc4dd, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.75 }),
    );
  }
  return remember("glass", () => {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0x2f4753,
      roughness: 0.06,
      metalness: 0,
      transmission: 0,
      // A low-e coating is quite reflective at grazing angles and fairly dark
      // head-on, which is exactly what specular intensity plus a dark base gives.
      reflectivity: 0.62,
      clearcoat: 0.85,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.35,
    });
    return m;
  });
}

export function mullionMaterial(mode: RenderMode): THREE.Material {
  if (mode === "clay") return wallMaterial("fiber_cement", "clay");
  return remember("mullion", () =>
    new THREE.MeshStandardMaterial({ color: 0x6d7479, roughness: 0.45, metalness: 0.7 }),
  );
}

export function roofMaterial(mode: RenderMode, pitched: boolean, assembly: RoofAssembly = "membrane"): THREE.Material {
  // A green roof is the one assembly choice that changes the aerial view as
  // much as it changes the number, so it has to read as planted.
  if (!pitched && mode !== "clay" && (assembly === "green_extensive" || assembly === "green_intensive")) {
    return remember(`roof-green-${assembly}-${mode}`, () =>
      new THREE.MeshStandardMaterial({
        color: assembly === "green_intensive" ? 0x4e7a3e : 0x6e8c52,
        roughness: 0.98,
        metalness: 0,
        flatShading: true,
      }),
    );
  }
  if (!pitched && mode === "realistic" && assembly === "ballasted") {
    return remember("roof-ballasted", () =>
      new THREE.MeshStandardMaterial({ color: 0x9a9489, roughness: 1, metalness: 0 }),
    );
  }
  return roofMaterialBase(mode, pitched);
}

function roofMaterialBase(mode: RenderMode, pitched: boolean): THREE.Material {
  if (mode === "clay") {
    return remember("clay-roof", () => new THREE.MeshStandardMaterial({ color: CLAY_ROOF, roughness: 0.94, metalness: 0 }));
  }
  if (mode === "program") {
    return remember("program-roof", () => new THREE.MeshStandardMaterial({ color: 0x7d868f, roughness: 0.85, metalness: 0 }));
  }
  return pitched
    ? remember("roof-pitched", () => {
        const tex = skinTextures("metal_panel");
        return new THREE.MeshStandardMaterial({
          map: tex.map, normalMap: tex.normalMap, roughness: 0.5, metalness: 0.55,
          color: 0x6e7378,
        });
      })
    : remember("roof-flat", () =>
        new THREE.MeshStandardMaterial({ color: 0x8e8f8a, roughness: 0.96, metalness: 0 }),
      );
}

/** Ground plane. A subtle noise breaks up the flatness without reading as grass. */
export function groundMaterial(mode: RenderMode): THREE.Material {
  return remember(`ground-${mode}`, () => {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const base = mode === "clay" ? "#dedbd4" : "#8f9585";
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    let seed = 1337;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = ((seed >>> 16) / 65535 - 0.5) * 26;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(60, 60);
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
  });
}

export function pavingMaterial(mode: RenderMode): THREE.Material {
  return remember(`paving-${mode}`, () =>
    new THREE.MeshStandardMaterial({ color: mode === "clay" ? 0xd2cfc8 : 0x54565a, roughness: 0.95, metalness: 0 }),
  );
}

/**
 * Base course and floor-line reveals. Deliberately a shade darker than the
 * field material so the horizontal lines carry even in flat overcast light,
 * where a same-tone reveal would vanish.
 */
export function trimMaterial(mode: RenderMode, tint?: number): THREE.Material {
  if (mode === "clay") {
    return remember("clay-trim", () => new THREE.MeshStandardMaterial({ color: 0xd6d2ca, roughness: 0.9 }));
  }
  if (mode === "program") {
    const color = tint ?? 0x8a939b;
    return remember(`program-trim-${color}`, () =>
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.72), roughness: 0.8 }),
    );
  }
  return remember("trim", () =>
    new THREE.MeshStandardMaterial({ color: 0x9c9791, roughness: 0.88, metalness: 0.02 }),
  );
}

/** Planting: terrace planters and green roofs. */
export function plantingMaterial(mode: RenderMode): THREE.Material {
  if (mode === "clay") {
    return remember("clay-planting", () => new THREE.MeshStandardMaterial({ color: 0xe2dfd8, roughness: 0.95 }));
  }
  return remember(`planting-${mode}`, () =>
    new THREE.MeshStandardMaterial({ color: mode === "program" ? 0x8fd14f : 0x5f7d47, roughness: 0.95, flatShading: true }),
  );
}

/**
 * Storefront glazing for lobby volumes.
 *
 * Deliberately lighter and less reflective than the vision glass used in the
 * windows: a lobby is the one place you are meant to see into, and rendering it
 * in the same dark low-e as the punched openings turns the entrance — usually
 * the most expensive move on the elevation — into a blank slab.
 */
export function storefrontMaterial(mode: RenderMode): THREE.Material {
  if (mode === "clay") return glassMaterial("clay");
  if (mode === "program") {
    return remember("program-storefront", () =>
      new THREE.MeshStandardMaterial({ color: 0xbcd8ea, roughness: 0.2, metalness: 0.05 }),
    );
  }
  return remember("storefront", () => {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0x7c98a6,
      roughness: 0.05,
      metalness: 0,
      reflectivity: 0.4,
      clearcoat: 0.7,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.5,
      transparent: true,
      opacity: 0.82,
    });
    return m;
  });
}

/**
 * Metalwork: canopies, screens, shades.
 *
 * Deliberately reads as a different family from the cladding — a canopy that
 * matches the wall it hangs on disappears, and the whole reason to draw one is
 * that the client can see it.
 */
export function metalMaterial(mode: RenderMode, tint?: number): THREE.Material {
  if (mode === "clay") {
    return remember("clay-metal", () => new THREE.MeshStandardMaterial({ color: 0xdedad3, roughness: 0.85 }));
  }
  if (mode === "program") {
    const color = tint ?? 0x7d868f;
    return remember(`program-metal-${color}`, () =>
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.6), roughness: 0.5, metalness: 0.4 }),
    );
  }
  // Light anodised rather than dark: a fin array seen obliquely occludes into
  // a continuous surface, and in a dark metal that surface reads as a blank
  // wall rather than as the shading device it is.
  return remember("metal", () =>
    new THREE.MeshStandardMaterial({ color: 0x9aa3a9, roughness: 0.34, metalness: 0.72, envMapIntensity: 1.2 }),
  );
}

/** Context buildings: present but visibly not scope. */
export function contextMaterial(): THREE.Material {
  return remember("context", () =>
    new THREE.MeshStandardMaterial({ color: 0xb4b6b8, roughness: 0.95, metalness: 0 }),
  );
}

export function disposeMaterials(): void {
  for (const m of cache.values()) m.dispose();
  cache.clear();
}
