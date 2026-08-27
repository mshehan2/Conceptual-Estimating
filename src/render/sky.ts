/**
 * Sky and image-based lighting.
 *
 * PBR materials need an environment to reflect or they read as plastic. Rather
 * than ship an HDRI, the sky is a shader-driven gradient — horizon haze, zenith
 * blue, a sun disc, and a ground bounce — rendered once into a prefiltered
 * cubemap through PMREM. That cubemap is both the visible background and the
 * light source for every reflective surface, so a metal panel picks up the same
 * warm sky the sun is coming from.
 */

import * as THREE from "three";

export interface SkyParams {
  /** Sun direction, pointing from the scene toward the sun. */
  sunDirection: THREE.Vector3;
  /** 0 = clear, 1 = fully overcast. */
  overcast: number;
  /** Overall sky brightness multiplier. */
  exposure: number;
  /** Ground albedo colour that bounces back up. */
  groundColor: THREE.Color;
}

export const DEFAULT_SKY: SkyParams = {
  sunDirection: new THREE.Vector3(0.4, 0.7, 0.55).normalize(),
  overcast: 0.15,
  exposure: 1,
  groundColor: new THREE.Color(0x8d8b80),
};

const VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uSun;
  uniform float uOvercast;
  uniform float uExposure;
  uniform vec3 uGround;

  void main() {
    vec3 dir = normalize(vWorld);
    float h = dir.y;

    // Zenith to horizon gradient, flattening as it clouds over.
    vec3 zenith = mix(vec3(0.19, 0.36, 0.66), vec3(0.60, 0.63, 0.67), uOvercast);
    vec3 horizon = mix(vec3(0.78, 0.85, 0.93), vec3(0.74, 0.76, 0.79), uOvercast);
    float t = pow(clamp(h, 0.0, 1.0), 0.42);
    vec3 sky = mix(horizon, zenith, t);

    // Warm the sky toward the sun, strongest near the horizon.
    float sunDot = max(dot(dir, normalize(uSun)), 0.0);
    float glow = pow(sunDot, 5.0) * (1.0 - uOvercast * 0.75);
    sky += vec3(0.55, 0.34, 0.14) * glow;

    // The sun disc itself, the brightest thing a reflection can pick up.
    float disc = smoothstep(0.9992, 0.9997, sunDot) * (1.0 - uOvercast * 0.9);
    sky += vec3(9.0, 7.6, 6.0) * disc;

    // Below the horizon: the ground bounce that fills shadowed facades.
    float below = smoothstep(0.0, -0.22, h);
    sky = mix(sky, uGround, below);

    gl_FragColor = vec4(sky * uExposure, 1.0);
  }
`;

export class SkyEnvironment {
  readonly scene = new THREE.Scene();
  private material: THREE.ShaderMaterial;
  private pmrem: THREE.PMREMGenerator;
  private target: THREE.WebGLRenderTarget | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSun: { value: new THREE.Vector3(0.4, 0.7, 0.55) },
        uOvercast: { value: 0.15 },
        uExposure: { value: 1 },
        uGround: { value: new THREE.Color(0x8d8b80) },
      },
    });
    this.scene.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), this.material));
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
  }

  /** Rebuild the environment. Call when the sun or weather changes, not per frame. */
  update(params: Partial<SkyParams>): THREE.Texture {
    const u = this.material.uniforms;
    if (params.sunDirection) u.uSun.value.copy(params.sunDirection);
    if (params.overcast != null) u.uOvercast.value = params.overcast;
    if (params.exposure != null) u.uExposure.value = params.exposure;
    if (params.groundColor) u.uGround.value.copy(params.groundColor);

    this.target?.dispose();
    this.target = this.pmrem.fromScene(this.scene, 0.04);
    return this.target.texture;
  }

  dispose(): void {
    this.target?.dispose();
    this.pmrem.dispose();
    this.material.dispose();
  }
}
