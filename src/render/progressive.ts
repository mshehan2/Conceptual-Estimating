/**
 * Progressive accumulation renderer.
 *
 * While the camera moves, this draws one plain frame — fast, aliased, hard
 * shadows. The moment the camera stops, it starts accumulating: each additional
 * sample re-renders the scene with the projection jittered by a sub-pixel
 * offset and the sun jittered within a small angular cone, then averages the
 * result into an HDR buffer.
 *
 * Averaging those two jitters is what buys the quality:
 *   - sub-pixel projection jitter converges to proper antialiasing, far past
 *     what MSAA gives, including on the normal-mapped facades
 *   - sun cone jitter converges to genuinely soft shadows with contact
 *     darkening where surfaces meet, because near an inside corner more of the
 *     sampled sun positions are occluded
 *
 * Both fall out of averaging, so there is no post-processing chain, no extra
 * dependency, and no screen-space artefacts. It costs frames, which is exactly
 * the resource available when nobody is dragging the mouse.
 */

import * as THREE from "three";

/** Radical-inverse Halton, for a jitter sequence that fills the pixel evenly. */
function halton(index: number, base: number): number {
  let result = 0;
  let f = 1 / base;
  let i = index;
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

const ACCUM_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Running average: weight = 1/(n+1) folds the new sample in without drift. */
const ACCUM_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tPrevious;
  uniform sampler2D tSample;
  uniform float uWeight;
  void main() {
    vec4 prev = texture2D(tPrevious, vUv);
    vec4 next = texture2D(tSample, vUv);
    gl_FragColor = mix(prev, next, uWeight);
  }
`;

/** Display pass: ACES filmic tone map plus sRGB, applied once at the end. */
const DISPLAY_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tAccum;
  uniform float uExposure;

  vec3 acesFilmic(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  void main() {
    vec3 hdr = texture2D(tAccum, vUv).rgb * uExposure;
    vec3 mapped = acesFilmic(hdr);
    gl_FragColor = vec4(pow(mapped, vec3(1.0 / 2.2)), 1.0);
  }
`;

export interface ProgressiveOptions {
  /** Samples to accumulate before the image is considered final. */
  maxSamples?: number;
  /** Half-angle of the sun cone, radians. Larger reads as a hazier day. */
  sunSpread?: number;
  exposure?: number;
}

export class ProgressiveRenderer {
  private renderer: THREE.WebGLRenderer;
  private sampleTarget: THREE.WebGLRenderTarget;
  private accum: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private accumIndex = 0;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private accumMaterial: THREE.ShaderMaterial;
  private displayMaterial: THREE.ShaderMaterial;
  private quad: THREE.Mesh;

  private samples = 0;
  private width = 1;
  private height = 1;

  maxSamples: number;
  sunSpread: number;
  exposure: number;

  /** The directional light whose direction is jittered for soft shadows. */
  sun: THREE.DirectionalLight | null = null;
  private sunBase = new THREE.Vector3(1, 1, 1);

  constructor(renderer: THREE.WebGLRenderer, options: ProgressiveOptions = {}) {
    this.renderer = renderer;
    this.maxSamples = options.maxSamples ?? 96;
    this.sunSpread = options.sunSpread ?? 0.035;
    this.exposure = options.exposure ?? 1;

    const targetOptions: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    };
    this.sampleTarget = new THREE.WebGLRenderTarget(1, 1, targetOptions);
    this.accum = [
      new THREE.WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false }),
      new THREE.WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false }),
    ];

    this.accumMaterial = new THREE.ShaderMaterial({
      vertexShader: ACCUM_VERT,
      fragmentShader: ACCUM_FRAG,
      uniforms: {
        tPrevious: { value: null },
        tSample: { value: null },
        uWeight: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.displayMaterial = new THREE.ShaderMaterial({
      vertexShader: ACCUM_VERT,
      fragmentShader: DISPLAY_FRAG,
      uniforms: {
        tAccum: { value: null },
        uExposure: { value: this.exposure },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.accumMaterial);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    const w = Math.max(1, Math.floor(width * pixelRatio));
    const h = Math.max(1, Math.floor(height * pixelRatio));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.sampleTarget.setSize(w, h);
    this.accum[0].setSize(w, h);
    this.accum[1].setSize(w, h);
    this.reset();
  }

  /** Discard the accumulated image. Call whenever anything visible changes. */
  reset(): void {
    this.samples = 0;
  }

  get sampleCount(): number {
    return this.samples;
  }

  get converged(): boolean {
    return this.samples >= this.maxSamples;
  }

  /** Fraction of the way to a finished image, 0..1. */
  get progress(): number {
    return Math.min(1, this.samples / this.maxSamples);
  }

  setSun(light: THREE.DirectionalLight | null): void {
    this.sun = light;
    if (light) this.sunBase.copy(light.position);
  }

  /**
   * Draw one frame.
   *
   * `interactive` skips accumulation entirely — one direct render to the canvas,
   * which is what a camera drag needs. Otherwise this adds one sample and
   * displays the running average.
   */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, interactive: boolean): void {
    if (interactive) {
      this.restoreSun();
      camera.clearViewOffset();
      this.renderer.setRenderTarget(null);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = this.exposure;
      this.renderer.render(scene, camera);
      this.samples = 0;
      return;
    }

    if (this.converged) {
      this.display();
      return;
    }

    const n = this.samples;

    // Sub-pixel projection jitter, in pixels, centred on the pixel.
    const jx = halton(n + 1, 2) - 0.5;
    const jy = halton(n + 1, 3) - 0.5;
    camera.setViewOffset(this.width, this.height, jx, jy, this.width, this.height);

    this.jitterSun(n);

    // Scene renders linear; tone mapping happens once in the display pass so
    // samples average in HDR rather than after being crushed to display range.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setRenderTarget(this.sampleTarget);
    this.renderer.clear();
    this.renderer.render(scene, camera);

    // Fold the sample into the running average.
    const previous = this.accum[this.accumIndex];
    const next = this.accum[1 - this.accumIndex];
    this.quad.material = this.accumMaterial;
    this.accumMaterial.uniforms.tPrevious.value = previous.texture;
    this.accumMaterial.uniforms.tSample.value = this.sampleTarget.texture;
    this.accumMaterial.uniforms.uWeight.value = n === 0 ? 1 : 1 / (n + 1);
    this.renderer.setRenderTarget(next);
    this.renderer.render(this.quadScene, this.quadCamera);
    this.accumIndex = 1 - this.accumIndex;

    this.samples = n + 1;
    camera.clearViewOffset();
    this.display();
  }

  private display(): void {
    this.quad.material = this.displayMaterial;
    this.displayMaterial.uniforms.tAccum.value = this.accum[this.accumIndex].texture;
    this.displayMaterial.uniforms.uExposure.value = this.exposure;
    this.renderer.setRenderTarget(null);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  /**
   * Offset the sun within a small cone. Averaged over many samples this is a
   * physically sensible area light: the penumbra widens with distance from the
   * occluder exactly as it should, for free.
   */
  private jitterSun(n: number): void {
    const light = this.sun;
    if (!light) return;

    const radius = this.sunBase.length();
    const u = halton(n + 1, 5) * 2 - 1;
    const v = halton(n + 1, 7) * 2 - 1;

    // Build a basis around the sun direction and nudge within it.
    const dir = this.sunBase.clone().normalize();
    const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const forward = new THREE.Vector3().crossVectors(right, dir).normalize();

    light.position
      .copy(dir)
      .addScaledVector(right, u * this.sunSpread)
      .addScaledVector(forward, v * this.sunSpread)
      .normalize()
      .multiplyScalar(radius);

    // The shadow map must be redrawn for the jitter to reach the shadows. The
    // flag that forces that lives on the renderer's shadow map, not on the
    // light's own shadow — setting the latter silently does nothing.
    this.renderer.shadowMap.needsUpdate = true;
  }

  private restoreSun(): void {
    if (this.sun) this.sun.position.copy(this.sunBase);
  }

  /**
   * Render a still at arbitrary resolution and sample count, independent of
   * the on-screen canvas. This is the export path: 4K at 400 samples takes a
   * few seconds and produces something worth putting in front of a client.
   */
  async renderStill(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    samples: number,
    onProgress?: (fraction: number) => void,
  ): Promise<string> {
    const previousSize = new THREE.Vector2();
    this.renderer.getSize(previousSize);
    const previousRatio = this.renderer.getPixelRatio();
    const previousAspect = camera.aspect;
    const previousSamples = this.samples;

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    this.setSize(width, height, 1);
    this.reset();

    const wasMax = this.maxSamples;
    this.maxSamples = samples;

    for (let i = 0; i < samples; i++) {
      this.render(scene, camera, false);
      if (onProgress) onProgress((i + 1) / samples);
      // Yield so the browser can paint progress and stay responsive.
      if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
    }

    const dataUrl = this.renderer.domElement.toDataURL("image/png");

    this.maxSamples = wasMax;
    this.renderer.setPixelRatio(previousRatio);
    this.renderer.setSize(previousSize.x, previousSize.y, false);
    camera.aspect = previousAspect;
    camera.updateProjectionMatrix();
    this.setSize(previousSize.x, previousSize.y, previousRatio);
    this.samples = previousSamples;
    this.reset();

    return dataUrl;
  }

  dispose(): void {
    this.sampleTarget.dispose();
    this.accum[0].dispose();
    this.accum[1].dispose();
    this.accumMaterial.dispose();
    this.displayMaterial.dispose();
    this.quad.geometry.dispose();
  }
}

export { halton };
