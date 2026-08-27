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
  varying vec3 vDirection;
  void main() {
    // The view direction, not the world position: the dome is centred on the
    // camera, so a direction taken from the world origin would skew the whole
    // gradient as soon as the camera moved away from it.
    vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
    vDirection = world - cameraPosition;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vDirection;
  uniform vec3 uSun;
  uniform float uOvercast;
  uniform float uExposure;
  uniform vec3 uGround;

  void main() {
    vec3 dir = normalize(vDirection);
    float h = dir.y;

    // Zenith to horizon gradient, flattening as it clouds over. The exponent
    // keeps real colour in the lower half of the dome: at eye level almost all
    // the visible sky is within 20 degrees of the horizon, and a gradient that
    // only saturates overhead renders as flat grey in every street-level view.
    vec3 zenith = mix(vec3(0.045, 0.135, 0.44), vec3(0.30, 0.335, 0.38), uOvercast);
    vec3 horizon = mix(vec3(0.30, 0.42, 0.62), vec3(0.40, 0.425, 0.455), uOvercast);
    float t = pow(clamp(h, 0.0, 1.0), 0.85);
    vec3 sky = mix(horizon, zenith, t);

    // Warm the sky toward the sun, strongest near the horizon.
    float sunDot = max(dot(dir, normalize(uSun)), 0.0);
    float glow = pow(sunDot, 5.0) * (1.0 - uOvercast * 0.75);
    sky += vec3(0.55, 0.34, 0.14) * glow;

    // The sun disc itself, the brightest thing a reflection can pick up.
    float disc = smoothstep(0.9992, 0.9997, sunDot) * (1.0 - uOvercast * 0.9);
    sky += vec3(9.0, 7.6, 6.0) * disc;

    // Below the horizon: the ground bounce that fills shadowed facades. Kept
    // clearly darker than the sky so there is a horizon to see.
    float below = smoothstep(0.005, -0.14, h);
    sky = mix(sky, uGround * 0.62, below);

    gl_FragColor = vec4(sky * uExposure, 1.0);
  }
`;

function makeSkyMaterial(side: THREE.Side): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uSun: { value: new THREE.Vector3(0.4, 0.7, 0.55) },
      uOvercast: { value: 0.15 },
      uExposure: { value: 1 },
      uGround: { value: new THREE.Color(0x8d8b80) },
    },
  });
}

export class SkyEnvironment {
  /** Off-screen scene the environment map is baked from. */
  private readonly bakeScene = new THREE.Scene();
  /** The visible sky, added to the render scene as a dome around the camera. */
  readonly dome: THREE.Mesh;

  private bakeMaterial: THREE.ShaderMaterial;
  private domeMaterial: THREE.ShaderMaterial;
  private pmrem: THREE.PMREMGenerator;
  private target: THREE.WebGLRenderTarget | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.bakeMaterial = makeSkyMaterial(THREE.BackSide);
    this.bakeScene.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), this.bakeMaterial));

    // A PMREM result is a packed cubeUV atlas, not a cubemap — assigning it to
    // scene.background renders as a flat smear. The visible sky therefore needs
    // its own geometry, drawn first with depth off so it sits behind
    // everything without needing a huge far plane.
    this.domeMaterial = makeSkyMaterial(THREE.BackSide);
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.domeMaterial);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.name = "sky";
    this.dome.matrixAutoUpdate = false;

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
  }

  /**
   * Keep the dome centred on the camera, so it can never be walked out of.
   * Called from the render loop before drawing: doing it in `onBeforeRender` is
   * too late, because the object's world matrix has already been computed for
   * the frame by then.
   */
  followCamera(camera: THREE.PerspectiveCamera): void {
    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(Math.max(100, camera.far * 0.45));
    this.dome.updateMatrix();
    this.dome.updateMatrixWorld(true);
  }

  /** Rebuild the environment. Call when the sun or weather changes, not per frame. */
  update(params: Partial<SkyParams>): THREE.Texture {
    for (const material of [this.bakeMaterial, this.domeMaterial]) {
      const u = material.uniforms;
      if (params.sunDirection) u.uSun.value.copy(params.sunDirection);
      if (params.overcast != null) u.uOvercast.value = params.overcast;
      if (params.exposure != null) u.uExposure.value = params.exposure;
      if (params.groundColor) u.uGround.value.copy(params.groundColor);
    }

    this.target?.dispose();
    this.target = this.pmrem.fromScene(this.bakeScene, 0.04);
    return this.target.texture;
  }

  dispose(): void {
    this.target?.dispose();
    this.pmrem.dispose();
    this.bakeMaterial.dispose();
    this.domeMaterial.dispose();
    this.dome.geometry.dispose();
  }
}
