/**
 * Auxiliary render passes for AI conditioning.
 *
 * A photoreal pass driven by the beauty render alone will hallucinate: it adds
 * floors, slides windows around, invents a different building. For estimating
 * work that is worse than no render, because the picture has to be the building
 * that was priced.
 *
 * The advantage here is that we own the scene, so these passes are exact rather
 * than estimated. A typical arch-viz AI workflow runs a depth estimator over a
 * flat image and hopes; we can read true depth out of the depth buffer, derive
 * linework from real geometric discontinuities, and emit a material mask that
 * knows which pixels are glass and which are brick.
 */

import * as THREE from "three";

export type PassKind = "beauty" | "depth" | "normal" | "edge" | "mask";

/** Semantic category a mesh belongs to, for the material mask. */
export type MaskCategory =
  | "wall"
  | "glass"
  | "mullion"
  | "trim"
  | "roof"
  | "ground"
  | "paving"
  | "vegetation"
  | "vehicle"
  | "figure"
  | "context"
  | "sky";

/**
 * Mask colours. Chosen to be far apart in hue so a downstream model — or a
 * human compositing by hand — can separate them without ambiguity.
 */
export const MASK_COLORS: Record<MaskCategory, number> = {
  wall: 0xc8503c,
  glass: 0x2f6fd0,
  mullion: 0x1d2a3a,
  trim: 0xe0913a,
  roof: 0x7a3fa8,
  ground: 0x4f8f45,
  paving: 0x585d63,
  vegetation: 0x8fd14f,
  vehicle: 0xd8d8d8,
  figure: 0xf2c14e,
  context: 0x9aa0a6,
  sky: 0xdff0ff,
};

const DEPTH_VERT = /* glsl */ `
  varying float vViewDepth;
  void main() {
    // The entourage is drawn with InstancedMesh, and a custom ShaderMaterial
    // does not receive the instance transform automatically the way three's
    // built-in materials do. Without this every tree and car is missing from
    // the depth pass while being present in the render it is meant to describe.
    #ifdef USE_INSTANCING
      vec4 viewPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    #else
      vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    #endif
    vViewDepth = -viewPosition.z;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

/**
 * White near, black far — the convention depth-conditioned models expect.
 * Range is set from the scene's own extent each time rather than from the
 * camera's near/far, which span 1 to 20000 and would flatten every building
 * into the same shade.
 */
const DEPTH_FRAG = /* glsl */ `
  varying float vViewDepth;
  uniform float uNear;
  uniform float uFar;
  void main() {
    float d = clamp((vViewDepth - uNear) / max(0.001, uFar - uNear), 0.0, 1.0);
    gl_FragColor = vec4(vec3(1.0 - d), 1.0);
  }
`;

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * Linework from geometric discontinuity: a step in depth is a silhouette or an
 * occlusion edge, a step in normal is a crease. Both are exact here, so the
 * lines land on real corners rather than on texture contrast the way an
 * image-space edge detector would.
 */
const EDGE_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tDepth;
  uniform sampler2D tNormal;
  uniform vec2 uTexel;
  uniform float uDepthThreshold;
  uniform float uNormalThreshold;

  float depthAt(vec2 uv) { return texture2D(tDepth, uv).r; }
  vec3 normalAt(vec2 uv) { return texture2D(tNormal, uv).rgb * 2.0 - 1.0; }

  void main() {
    vec2 t = uTexel;
    float d = depthAt(vUv);

    // A first difference cannot tell a step from a ramp, and a ground plane
    // receding to the horizon IS a ramp — it was being detected as edge across
    // its entire length. The second difference is zero on any linear gradient
    // and spikes only at a genuine discontinuity, which is what a silhouette is.
    float dl = depthAt(vUv - vec2(t.x, 0.0));
    float dr = depthAt(vUv + vec2(t.x, 0.0));
    float du = depthAt(vUv - vec2(0.0, t.y));
    float dd = depthAt(vUv + vec2(0.0, t.y));
    float laplacian = abs(2.0 * d - dl - dr) + abs(2.0 * d - du - dd);
    float depthEdge = step(uDepthThreshold, laplacian);

    vec3 n = normalize(normalAt(vUv));
    float nx = 1.0 - dot(n, normalize(normalAt(vUv + vec2(t.x, 0.0))));
    float ny = 1.0 - dot(n, normalize(normalAt(vUv + vec2(0.0, t.y))));
    float normalEdge = step(uNormalThreshold, max(nx, ny));

    // Black lines on white: what line-conditioned models are trained on.
    float line = clamp(max(depthEdge, normalEdge), 0.0, 1.0);
    gl_FragColor = vec4(vec3(1.0 - line), 1.0);
  }
`;

interface PassContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
}

/**
 * Depth range covering the scene from the current camera, in world units.
 *
 * Measured over the SUBJECT only — buildings and entourage — never the ground
 * plane. The ground is thousands of feet across, so including it stretches the
 * range far past anything of interest and flattens the whole building into a
 * single near-white value. Excluding it means distant ground clips to black,
 * which is the correct read for a depth map anyway.
 */
const RANGE_EXCLUDED = new Set<MaskCategory>(["ground", "paving"]);

function depthRange(scene: THREE.Scene, camera: THREE.PerspectiveCamera): { near: number; far: number } {
  const box = new THREE.Box3();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o.name === "sky") return;
    const category = mesh.userData.maskCategory as MaskCategory | undefined;
    if (category && RANGE_EXCLUDED.has(category)) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const b = mesh.geometry.boundingBox;
    if (!b) return;
    box.union(b.clone().applyMatrix4(mesh.matrixWorld));
  });
  if (box.isEmpty()) return { near: 1, far: 1000 };

  // Distance from the eye to the nearest and furthest corners of the scene.
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));

  let near = Infinity;
  let far = 0;
  for (const c of corners) {
    const d = c.distanceTo(camera.position);
    near = Math.min(near, d);
    far = Math.max(far, d);
  }
  // A little headroom so the nearest surface is not pinned to pure white.
  return { near: Math.max(0.1, near * 0.92), far: far * 1.06 };
}

export class PassRenderer {
  private renderer: THREE.WebGLRenderer;
  private depthMaterial: THREE.ShaderMaterial;
  private normalMaterial: THREE.MeshNormalMaterial;
  private edgeMaterial: THREE.ShaderMaterial;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private maskMaterials = new Map<MaskCategory, THREE.MeshBasicMaterial>();

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    this.depthMaterial = new THREE.ShaderMaterial({
      vertexShader: DEPTH_VERT,
      fragmentShader: DEPTH_FRAG,
      uniforms: { uNear: { value: 1 }, uFar: { value: 1000 } },
      side: THREE.DoubleSide,
    });
    this.normalMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
    this.edgeMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: EDGE_FRAG,
      uniforms: {
        tDepth: { value: null },
        tNormal: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uDepthThreshold: { value: 0.006 },
        uNormalThreshold: { value: 0.2 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.edgeMaterial);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    for (const [category, color] of Object.entries(MASK_COLORS)) {
      this.maskMaterials.set(
        category as MaskCategory,
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false }),
      );
    }
  }

  /**
   * Render one auxiliary pass and return it as a PNG data URL.
   * The caller is responsible for restoring the viewport afterwards; every
   * pass here leaves the renderer's size and the scene's materials as it
   * found them.
   */
  render(kind: Exclude<PassKind, "beauty">, ctx: PassContext): string {
    const { renderer, scene, camera, width, height } = ctx;
    const previousSize = renderer.getSize(new THREE.Vector2());
    const previousRatio = renderer.getPixelRatio();
    const previousAspect = camera.aspect;
    const previousBackground = scene.background;
    const previousFog = scene.fog;
    const sky = scene.getObjectByName("sky");
    const skyWasVisible = sky?.visible ?? false;

    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.toneMapping = THREE.NoToneMapping;

    // Auxiliary passes describe geometry, so atmosphere and sky are noise.
    if (sky) sky.visible = false;
    scene.fog = null;
    scene.background = new THREE.Color(kind === "mask" ? MASK_COLORS.sky : 0x000000);

    let dataUrl: string;
    try {
      if (kind === "depth" || kind === "normal") {
        this.renderGeometryPass(kind, ctx);
        dataUrl = renderer.domElement.toDataURL("image/png");
      } else if (kind === "mask") {
        dataUrl = this.renderMaskPass(ctx);
      } else {
        dataUrl = this.renderEdgePass(ctx);
      }
    } finally {
      scene.overrideMaterial = null;
      scene.background = previousBackground;
      scene.fog = previousFog;
      if (sky) sky.visible = skyWasVisible;
      renderer.setPixelRatio(previousRatio);
      renderer.setSize(previousSize.x, previousSize.y, false);
      camera.aspect = previousAspect;
      camera.updateProjectionMatrix();
    }

    return dataUrl;
  }

  private renderGeometryPass(kind: "depth" | "normal", ctx: PassContext): void {
    const { renderer, scene, camera } = ctx;
    if (kind === "depth") {
      const { near, far } = depthRange(scene, camera);
      this.depthMaterial.uniforms.uNear.value = near;
      this.depthMaterial.uniforms.uFar.value = far;
      scene.overrideMaterial = this.depthMaterial;
    } else {
      scene.overrideMaterial = this.normalMaterial;
    }
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
  }

  /** Flat colour per semantic category, read from each mesh's userData. */
  private renderMaskPass(ctx: PassContext): string {
    const { renderer, scene, camera } = ctx;
    const swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];

    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || o.name === "sky") return;
      const category = (mesh.userData.maskCategory as MaskCategory) ?? "wall";
      const replacement = this.maskMaterials.get(category);
      if (!replacement) return;
      swapped.push({ mesh, material: mesh.material });
      mesh.material = replacement;
    });

    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL("image/png");

    for (const { mesh, material } of swapped) mesh.material = material;
    return dataUrl;
  }

  /** Depth and normal into off-screen targets, then a discontinuity pass. */
  private renderEdgePass(ctx: PassContext): string {
    const { renderer, scene, camera, width, height } = ctx;
    const options: THREE.RenderTargetOptions = {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    };
    const depthTarget = new THREE.WebGLRenderTarget(width, height, options);
    const normalTarget = new THREE.WebGLRenderTarget(width, height, options);

    try {
      const { near, far } = depthRange(scene, camera);
      this.depthMaterial.uniforms.uNear.value = near;
      this.depthMaterial.uniforms.uFar.value = far;

      scene.overrideMaterial = this.depthMaterial;
      renderer.setRenderTarget(depthTarget);
      renderer.clear();
      renderer.render(scene, camera);

      scene.overrideMaterial = this.normalMaterial;
      renderer.setRenderTarget(normalTarget);
      renderer.clear();
      renderer.render(scene, camera);
      scene.overrideMaterial = null;

      this.edgeMaterial.uniforms.tDepth.value = depthTarget.texture;
      this.edgeMaterial.uniforms.tNormal.value = normalTarget.texture;
      this.edgeMaterial.uniforms.uTexel.value.set(1 / width, 1 / height);
      this.quad.material = this.edgeMaterial;

      renderer.setRenderTarget(null);
      renderer.render(this.quadScene, this.quadCamera);
      return renderer.domElement.toDataURL("image/png");
    } finally {
      depthTarget.dispose();
      normalTarget.dispose();
    }
  }

  dispose(): void {
    this.depthMaterial.dispose();
    this.normalMaterial.dispose();
    this.edgeMaterial.dispose();
    this.quad.geometry.dispose();
    for (const m of this.maskMaterials.values()) m.dispose();
  }
}
