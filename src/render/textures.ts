/**
 * Procedural PBR texture generation.
 *
 * Every facade material is drawn on a canvas at load time rather than shipped
 * as image files: it keeps the app self-contained (the single-file build still
 * works offline) and lets a material respond to its own parameters — brick
 * course height, panel module, joint width.
 *
 * Each material produces three maps drawn from one height field, so the albedo,
 * the normal, and the roughness always agree about where the joints are.
 */

import * as THREE from "three";
import type { SkinKey } from "@/markets/types";

const SIZE = 512;

interface Canvas2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function makeCanvas(size = SIZE): Canvas2D {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  return { canvas, ctx };
}

/** Deterministic value noise, so a rebuild produces the identical texture. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive a tangent-space normal map from a grayscale height canvas.
 * Sobel gradients, so joints and edges read as real relief under a moving sun.
 */
function normalFromHeight(height: Canvas2D, strength: number): HTMLCanvasElement {
  const size = height.canvas.width;
  const src = height.ctx.getImageData(0, 0, size, size).data;
  const out = makeCanvas(size);
  const img = out.ctx.createImageData(size, size);

  const at = (x: number, y: number) => {
    const xi = (x + size) % size;
    const yi = (y + size) % size;
    return src[(yi * size + xi) * 4] / 255;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));

      // Normalize the gradient into a unit normal, then pack to 0..255.
      const nx = dx * strength;
      const ny = dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      const i = (y * size + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  out.ctx.putImageData(img, 0, 0);
  return out.canvas;
}

export interface SkinTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalScale: number;
  /** World feet covered by one texture repeat, for correct UV scaling. */
  tileFeet: number;
  roughness: number;
  metalness: number;
  color: number;
}

// ---------------------------------------------------------------------------
// Material painters. Each fills an albedo canvas, a height canvas, and a
// roughness canvas from the same layout.
// ---------------------------------------------------------------------------

type Painter = (albedo: Canvas2D, height: Canvas2D, rough: Canvas2D, rnd: () => number) => void;

const fill = (c: Canvas2D, style: string) => {
  c.ctx.fillStyle = style;
  c.ctx.fillRect(0, 0, c.canvas.width, c.canvas.height);
};

/** Coursed masonry: running bond with recessed mortar joints. */
const paintBrick =
  (base: [number, number, number], variance: number, courses: number): Painter =>
  (albedo, height, rough, rnd) => {
    fill(albedo, "#8d8378");
    fill(height, "#3a3a3a"); // mortar sits low
    fill(rough, "#c8c8c8");

    const size = albedo.canvas.width;
    const courseH = size / courses;
    const joint = Math.max(1.5, courseH * 0.13);
    const brickW = courseH * 2.6;

    for (let row = 0; row < courses; row++) {
      const y = row * courseH;
      const offset = row % 2 ? brickW / 2 : 0;
      for (let x = -brickW; x < size + brickW; x += brickW) {
        const bx = x + offset + joint / 2;
        const bw = brickW - joint;
        const bh = courseH - joint;
        const v = (rnd() - 0.5) * variance;
        const r = Math.max(0, Math.min(255, base[0] + v));
        const g = Math.max(0, Math.min(255, base[1] + v * 0.8));
        const b = Math.max(0, Math.min(255, base[2] + v * 0.7));

        albedo.ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        albedo.ctx.fillRect(bx, y + joint / 2, bw, bh);

        // Each brick face stands proud of the joint by a consistent amount.
        const h = 200 + (rnd() - 0.5) * 22;
        height.ctx.fillStyle = `rgb(${h | 0},${h | 0},${h | 0})`;
        height.ctx.fillRect(bx, y + joint / 2, bw, bh);

        const rg = 150 + (rnd() - 0.5) * 40;
        rough.ctx.fillStyle = `rgb(${rg | 0},${rg | 0},${rg | 0})`;
        rough.ctx.fillRect(bx, y + joint / 2, bw, bh);
      }
    }
  };

/** Lapped horizontal siding: a shadow line under every course. */
const paintLapSiding =
  (base: [number, number, number], courses: number): Painter =>
  (albedo, height, rough, rnd) => {
    const size = albedo.canvas.width;
    const courseH = size / courses;
    fill(rough, "#b4b4b4");

    for (let row = 0; row < courses; row++) {
      const y = row * courseH;
      const v = (rnd() - 0.5) * 8;
      albedo.ctx.fillStyle = `rgb(${(base[0] + v) | 0},${(base[1] + v) | 0},${(base[2] + v) | 0})`;
      albedo.ctx.fillRect(0, y, size, courseH);

      // Height ramps up across the course then drops at the lap.
      const grad = height.ctx.createLinearGradient(0, y, 0, y + courseH);
      grad.addColorStop(0, "#787878");
      grad.addColorStop(0.85, "#e6e6e6");
      grad.addColorStop(1, "#2a2a2a");
      height.ctx.fillStyle = grad;
      height.ctx.fillRect(0, y, size, courseH);

      // The shadow line is darker in albedo too.
      // The lap shadow has to be strong: at any real viewing distance a course
      // line is about one pixel tall, and a subtle line at one pixel is no line.
      albedo.ctx.fillStyle = "rgba(0,0,0,0.42)";
      albedo.ctx.fillRect(0, y + courseH - Math.max(1.5, courseH * 0.12), size, Math.max(1.5, courseH * 0.12));
    }
  };

/** Flat panels on a module with reveal joints between them. */
const paintPanel =
  (base: [number, number, number], cols: number, rows: number, jointDark: number): Painter =>
  (albedo, height, rough, rnd) => {
    const size = albedo.canvas.width;
    fill(albedo, `rgb(${base[0] * 0.55 | 0},${base[1] * 0.55 | 0},${base[2] * 0.55 | 0})`);
    fill(height, "#2e2e2e");
    fill(rough, "#8c8c8c");

    const cw = size / cols;
    const ch = size / rows;
    const joint = Math.max(1.5, Math.min(cw, ch) * 0.05);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = (rnd() - 0.5) * 10;
        albedo.ctx.fillStyle = `rgb(${(base[0] + v) | 0},${(base[1] + v) | 0},${(base[2] + v) | 0})`;
        albedo.ctx.fillRect(c * cw + joint, r * ch + joint, cw - joint * 2, ch - joint * 2);
        height.ctx.fillStyle = "#dcdcdc";
        height.ctx.fillRect(c * cw + joint, r * ch + joint, cw - joint * 2, ch - joint * 2);
        const rg = 130 + (rnd() - 0.5) * 20 + jointDark * 0;
        rough.ctx.fillStyle = `rgb(${rg | 0},${rg | 0},${rg | 0})`;
        rough.ctx.fillRect(c * cw + joint, r * ch + joint, cw - joint * 2, ch - joint * 2);
      }
    }
  };

/** Troweled render: fine stipple, no joints. */
const paintStucco =
  (base: [number, number, number], grain: number): Painter =>
  (albedo, height, rough, rnd) => {
    const size = albedo.canvas.width;
    fill(albedo, `rgb(${base[0]},${base[1]},${base[2]})`);
    fill(height, "#808080");
    fill(rough, "#d2d2d2");

    const img = albedo.ctx.getImageData(0, 0, size, size);
    const hImg = height.ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * grain;
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
      const h = 128 + n * 2.2;
      hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = Math.max(0, Math.min(255, h));
    }
    albedo.ctx.putImageData(img, 0, 0);
    height.ctx.putImageData(hImg, 0, 0);
  };

/** Vertical rib profile, as on standing-seam and insulated metal panel. */
const paintRibbed =
  (base: [number, number, number], ribs: number, metal: boolean): Painter =>
  (albedo, height, rough, rnd) => {
    const size = albedo.canvas.width;
    fill(albedo, `rgb(${base[0]},${base[1]},${base[2]})`);
    fill(rough, metal ? "#5a5a5a" : "#9b9b9b");

    const rw = size / ribs;
    for (let i = 0; i < ribs; i++) {
      const x = i * rw;
      const grad = height.ctx.createLinearGradient(x, 0, x + rw, 0);
      grad.addColorStop(0, "#242424");
      grad.addColorStop(0.12, "#f0f0f0");
      grad.addColorStop(0.88, "#f0f0f0");
      grad.addColorStop(1, "#242424");
      height.ctx.fillStyle = grad;
      height.ctx.fillRect(x, 0, rw, size);

      // A soft sheen band down each rib sells the metal.
      const ag = albedo.ctx.createLinearGradient(x, 0, x + rw, 0);
      const v = (rnd() - 0.5) * 6;
      const c = (k: number) => Math.max(0, Math.min(255, (k + v) | 0));
      ag.addColorStop(0, `rgb(${c(base[0] * 0.72)},${c(base[1] * 0.72)},${c(base[2] * 0.72)})`);
      ag.addColorStop(0.4, `rgb(${c(base[0] * 1.08)},${c(base[1] * 1.08)},${c(base[2] * 1.08)})`);
      ag.addColorStop(1, `rgb(${c(base[0] * 0.78)},${c(base[1] * 0.78)},${c(base[2] * 0.78)})`);
      albedo.ctx.fillStyle = ag;
      albedo.ctx.fillRect(x, 0, rw, size);
    }
  };

/** Random ashlar stone coursing. */
const paintStone: Painter = (albedo, height, rough, rnd) => {
  const size = albedo.canvas.width;
  fill(albedo, "#6e6a63");
  fill(height, "#3c3c3c");
  fill(rough, "#dcdcdc");

  const courses = 9;
  const courseH = size / courses;
  for (let row = 0; row < courses; row++) {
    const y = row * courseH;
    let x = -rnd() * courseH * 2;
    while (x < size) {
      const w = courseH * (1.1 + rnd() * 1.9);
      const joint = 2.5;
      const tone = 128 + rnd() * 52;
      albedo.ctx.fillStyle = `rgb(${tone | 0},${(tone * 0.96) | 0},${(tone * 0.88) | 0})`;
      albedo.ctx.fillRect(x + joint, y + joint, w - joint, courseH - joint);
      const h = 190 + rnd() * 50;
      height.ctx.fillStyle = `rgb(${h | 0},${h | 0},${h | 0})`;
      height.ctx.fillRect(x + joint, y + joint, w - joint, courseH - joint);
      const rg = 190 + rnd() * 45;
      rough.ctx.fillStyle = `rgb(${rg | 0},${rg | 0},${rg | 0})`;
      rough.ctx.fillRect(x + joint, y + joint, w - joint, courseH - joint);
      x += w;
    }
  }
};

/** Vertical board-and-batten wood. */
const paintWood: Painter = (albedo, height, rough, rnd) => {
  const size = albedo.canvas.width;
  fill(rough, "#c0c0c0");
  const boards = 12;
  const bw = size / boards;
  for (let i = 0; i < boards; i++) {
    const x = i * bw;
    const tone = 118 + rnd() * 34;
    albedo.ctx.fillStyle = `rgb(${tone | 0},${(tone * 0.78) | 0},${(tone * 0.55) | 0})`;
    albedo.ctx.fillRect(x, 0, bw, size);
    // Grain
    for (let g = 0; g < 26; g++) {
      albedo.ctx.strokeStyle = `rgba(60,40,24,${0.05 + rnd() * 0.09})`;
      albedo.ctx.lineWidth = 0.6 + rnd();
      albedo.ctx.beginPath();
      const gy = rnd() * size;
      albedo.ctx.moveTo(x, gy);
      albedo.ctx.bezierCurveTo(x + bw * 0.3, gy + (rnd() - 0.5) * 8, x + bw * 0.7, gy + (rnd() - 0.5) * 8, x + bw, gy);
      albedo.ctx.stroke();
    }
    height.ctx.fillStyle = "#c8c8c8";
    height.ctx.fillRect(x + 1, 0, bw - 2, size);
    // Batten every other joint
    if (i % 2 === 0) {
      albedo.ctx.fillStyle = "rgba(0,0,0,0.18)";
      albedo.ctx.fillRect(x - 2, 0, 5, size);
      height.ctx.fillStyle = "#ffffff";
      height.ctx.fillRect(x - 2, 0, 5, size);
    }
  }
};

/** Curtain wall spandrel: dark glass with a mullion grid. */
const paintSpandrel: Painter = (albedo, height, rough, rnd) => {
  const size = albedo.canvas.width;
  fill(albedo, "#2c3944");
  fill(height, "#c8c8c8");
  fill(rough, "#3c3c3c");

  const cols = 4;
  const rows = 4;
  const cw = size / cols;
  const ch = size / rows;
  albedo.ctx.fillStyle = "#8f979d";
  height.ctx.fillStyle = "#ffffff";
  rough.ctx.fillStyle = "#9a9a9a";
  const mull = Math.max(2, cw * 0.055);
  for (let c = 0; c <= cols; c++) {
    albedo.ctx.fillRect(c * cw - mull / 2, 0, mull, size);
    height.ctx.fillRect(c * cw - mull / 2, 0, mull, size);
    rough.ctx.fillRect(c * cw - mull / 2, 0, mull, size);
  }
  for (let r = 0; r <= rows; r++) {
    albedo.ctx.fillRect(0, r * ch - mull / 2, size, mull);
    height.ctx.fillRect(0, r * ch - mull / 2, size, mull);
    rough.ctx.fillRect(0, r * ch - mull / 2, size, mull);
  }
  // Faint reflection variation pane to pane.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      albedo.ctx.fillStyle = `rgba(${140 + rnd() * 50 | 0},${160 + rnd() * 50 | 0},${180 + rnd() * 50 | 0},${0.06 + rnd() * 0.1})`;
      albedo.ctx.fillRect(c * cw + mull, r * ch + mull, cw - mull * 2, ch - mull * 2);
    }
  }
};

// ---------------------------------------------------------------------------

interface SkinSpec {
  painter: Painter;
  tileFeet: number;
  normalScale: number;
  roughness: number;
  metalness: number;
  color: number;
  seed: number;
  label: string;
}

export const SKIN_SPECS: Record<SkinKey, SkinSpec> = {
  brick: {
    painter: paintBrick([146, 76, 54], 44, 12),
    tileFeet: 8, normalScale: 1.1, roughness: 0.92, metalness: 0, color: 0xffffff, seed: 11,
    label: "Brick veneer",
  },
  fiber_cement: {
    painter: paintLapSiding([172, 172, 166], 14),
    tileFeet: 9, normalScale: 0.85, roughness: 0.88, metalness: 0, color: 0xffffff, seed: 23,
    label: "Fiber cement siding",
  },
  metal_panel: {
    painter: paintRibbed([146, 152, 158], 10, true),
    tileFeet: 10, normalScale: 0.75, roughness: 0.42, metalness: 0.72, color: 0xffffff, seed: 37,
    label: "Metal panel",
  },
  stucco: {
    painter: paintStucco([198, 190, 176], 30),
    tileFeet: 12, normalScale: 0.4, roughness: 0.95, metalness: 0, color: 0xffffff, seed: 41,
    label: "Stucco",
  },
  eifs: {
    painter: paintStucco([206, 201, 190], 20),
    tileFeet: 12, normalScale: 0.32, roughness: 0.92, metalness: 0, color: 0xffffff, seed: 43,
    label: "EIFS",
  },
  precast: {
    painter: paintPanel([178, 175, 168], 3, 4, 0),
    tileFeet: 24, normalScale: 0.7, roughness: 0.86, metalness: 0.02, color: 0xffffff, seed: 53,
    label: "Architectural precast",
  },
  tilt_up: {
    painter: paintPanel([170, 167, 161], 2, 2, 0),
    tileFeet: 40, normalScale: 0.6, roughness: 0.93, metalness: 0, color: 0xffffff, seed: 59,
    label: "Tilt-up concrete",
  },
  insulated_panel: {
    painter: paintRibbed([206, 209, 212], 8, false),
    tileFeet: 12, normalScale: 0.5, roughness: 0.6, metalness: 0.35, color: 0xffffff, seed: 61,
    label: "Insulated metal panel",
  },
  wood: {
    painter: paintWood,
    tileFeet: 10, normalScale: 0.7, roughness: 0.85, metalness: 0, color: 0xffffff, seed: 67,
    label: "Wood siding",
  },
  stone: {
    painter: paintStone,
    tileFeet: 12, normalScale: 1.2, roughness: 0.9, metalness: 0, color: 0xffffff, seed: 71,
    label: "Stone veneer",
  },
  curtain_wall: {
    painter: paintSpandrel,
    tileFeet: 20, normalScale: 0.5, roughness: 0.22, metalness: 0.3, color: 0xffffff, seed: 73,
    label: "Curtain wall spandrel",
  },
};

const cache = new Map<SkinKey, SkinTextures>();

export function skinTextures(skin: SkinKey): SkinTextures {
  const hit = cache.get(skin);
  if (hit) return hit;

  const spec = SKIN_SPECS[skin] ?? SKIN_SPECS.fiber_cement;
  const albedo = makeCanvas();
  const height = makeCanvas();
  const rough = makeCanvas();
  spec.painter(albedo, height, rough, mulberry32(spec.seed));

  const map = new THREE.CanvasTexture(albedo.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(normalFromHeight(height, spec.normalScale * 3));
  const roughnessMap = new THREE.CanvasTexture(rough.canvas);

  for (const t of [map, normalMap, roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }

  const out: SkinTextures = {
    map,
    normalMap,
    roughnessMap,
    normalScale: spec.normalScale,
    tileFeet: spec.tileFeet,
    roughness: spec.roughness,
    metalness: spec.metalness,
    color: spec.color,
  };
  cache.set(skin, out);
  return out;
}

export function disposeTextures(): void {
  for (const t of cache.values()) {
    t.map.dispose();
    t.normalMap.dispose();
    t.roughnessMap.dispose();
  }
  cache.clear();
}
