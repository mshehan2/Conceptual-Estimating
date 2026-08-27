/**
 * The 3D viewport.
 *
 * Owns the renderer, the lighting rig, and the camera. Rebuilds the scene when
 * the scheme changes and resets the progressive accumulator whenever anything
 * visible moves, so the image on screen is always an average of frames that all
 * agree about what they are looking at.
 */

import { useEffect, useImperativeHandle, useRef, useState, forwardRef, useCallback } from "react";
import * as THREE from "three";
import type { Scheme } from "@/domain/project";
import { buildSchemeScene, type SceneBuild } from "./scene";
import { ProgressiveRenderer } from "./progressive";
import { SkyEnvironment } from "./sky";
import { solarPosition, sunLighting, sunVector, type SunInput } from "./sun";
import type { RenderMode } from "./materials";

export interface ViewportSettings {
  mode: RenderMode;
  showEntourage: boolean;
  showGround: boolean;
  sun: SunInput;
  overcast: number;
  exposure: number;
  /** Samples to accumulate on screen before stopping. */
  maxSamples: number;
}

export interface CameraPreset {
  id: string;
  label: string;
  /** Orbit azimuth in degrees clockwise from north. */
  azimuth: number;
  /** Elevation above horizon, degrees. */
  elevation: number;
  /** Distance as a multiple of the scene's bounding radius. */
  distance: number;
  /** Height of the look-at point as a fraction of building height. */
  targetHeight: number;
  fov: number;
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: "aerial", label: "Aerial", azimuth: 225, elevation: 34, distance: 2.4, targetHeight: 0.45, fov: 40 },
  { id: "approach", label: "Approach", azimuth: 205, elevation: 9, distance: 2.9, targetHeight: 0.3, fov: 34 },
  { id: "street", label: "Street", azimuth: 195, elevation: 3.5, distance: 1.9, targetHeight: 0.16, fov: 52 },
  { id: "corner", label: "Corner", azimuth: 240, elevation: 14, distance: 2.1, targetHeight: 0.35, fov: 42 },
  { id: "plan", label: "Plan", azimuth: 180, elevation: 88, distance: 2.2, targetHeight: 0, fov: 30 },
];

export interface ViewportHandle {
  /** Frame the whole scheme. */
  frameAll: () => void;
  applyPreset: (preset: CameraPreset) => void;
  /** Render a high-resolution still and return a PNG data URL. */
  renderStill: (
    width: number,
    height: number,
    samples: number,
    onProgress?: (fraction: number) => void,
  ) => Promise<string>;
  sampleCount: () => number;
}

interface Props {
  scheme: Scheme;
  settings: ViewportSettings;
  selectedMassId?: string | null;
  onSelectMass?: (id: string | null) => void;
  onProgress?: (fraction: number) => void;
}

/** Everything the render loop owns. Lives in a ref, never in React state. */
interface ViewportState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  progressive: ProgressiveRenderer;
  sky: SkyEnvironment;
  sun: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
  orbit: Orbit;
  build: SceneBuild | null;
  interacting: boolean;
  idleFrames: number;
}

/** Orbit state, kept in a ref because it changes far more often than React should hear about. */
interface Orbit {
  azimuth: number;
  elevation: number;
  distance: number;
  target: THREE.Vector3;
}

export const Viewport = forwardRef<ViewportHandle, Props>(function Viewport(
  { scheme, settings, selectedMassId, onSelectMass, onProgress },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<ViewportState | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Mount: renderer, camera, lights. Runs once. ---
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false, // the accumulator does this far better
        powerPreference: "high-performance",
        preserveDrawingBuffer: true, // needed for still export
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "WebGL unavailable");
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Shadows are redrawn deliberately, once per accumulated sample.
    renderer.shadowMap.autoUpdate = false;
    Object.assign(renderer.domElement.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
      touchAction: "none",
    });
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
    // Without haze the ground plane simply stops, and a visible edge to the
    // world reads as a modelling error rather than as distance.
    scene.fog = new THREE.Fog(0xbfc9d2, 1200, 9000);

    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun);
    scene.add(sun.target);

    // A hemisphere light on top of the environment map keeps north-facing
    // walls from going flat black when the sky map is dim.
    const fill = new THREE.HemisphereLight(0xbdd3ea, 0x6d6a5e, 0.18);
    scene.add(fill);

    const sky = new SkyEnvironment(renderer);
    scene.add(sky.dome);
    const progressive = new ProgressiveRenderer(renderer, { maxSamples: settings.maxSamples });
    progressive.setSun(sun);

    stateRef.current = {
      renderer, scene, camera, progressive, sky, sun, fill,
      orbit: { azimuth: 225, elevation: 22, distance: 600, target: new THREE.Vector3() },
      build: null,
      interacting: false,
      idleFrames: 0,
    };

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      progressive.setSize(w, h, renderer.getPixelRatio());
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const s = stateRef.current;
      if (!s) return;

      applyOrbit(s.camera, s.orbit);
      s.sky.followCamera(s.camera);

      if (s.interacting) {
        // Hard shadows, one pass, no accumulation — responsiveness wins.
        s.renderer.shadowMap.autoUpdate = true;
        s.progressive.render(s.scene, s.camera, true);
        s.renderer.shadowMap.autoUpdate = false;
        s.idleFrames = 0;
      } else {
        s.idleFrames++;
        // A couple of settled frames before committing to accumulation, so a
        // brief pause mid-drag does not throw away the interactive path.
        if (s.idleFrames > 2) {
          s.progressive.render(s.scene, s.camera, false);
          onProgress?.(s.progressive.progress);
        } else {
          s.progressive.render(s.scene, s.camera, true);
        }
      }
    };
    animate();
    setReady(true);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      const s = stateRef.current;
      if (s) {
        s.build?.dispose();
        s.progressive.dispose();
        s.sky.dispose();
        s.renderer.dispose();
      }
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      stateRef.current = null;
    };
    // Mount-only: settings changes are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Pointer interaction ---
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !ready) return;

    let pointerDown = false;
    let mode: "orbit" | "pan" = "orbit";
    let lastX = 0;
    let lastY = 0;
    let moved = false;

    const onDown = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s) return;
      pointerDown = true;
      moved = false;
      mode = e.button === 2 || e.shiftKey ? "pan" : "orbit";
      lastX = e.clientX;
      lastY = e.clientY;
      s.interacting = true;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s || !pointerDown) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;

      if (mode === "orbit") {
        s.orbit.azimuth = (s.orbit.azimuth - dx * 0.35 + 360) % 360;
        s.orbit.elevation = Math.max(-4, Math.min(89, s.orbit.elevation + dy * 0.28));
      } else {
        // Pan across the ground plane in the camera's own frame.
        const scale = s.orbit.distance * 0.0018;
        const az = (s.orbit.azimuth * Math.PI) / 180;
        const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
        const forward = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
        s.orbit.target.addScaledVector(right, -dx * scale);
        s.orbit.target.addScaledVector(forward, -dy * scale);
      }
      s.progressive.reset();
    };

    const onUp = (e: PointerEvent) => {
      const s = stateRef.current;
      pointerDown = false;
      if (s) {
        s.interacting = false;
        s.idleFrames = 0;
        s.progressive.reset();
        if (!moved && onSelectMass) onSelectMass(pickMass(s, e, mount));
      }
    };

    const onWheel = (e: WheelEvent) => {
      const s = stateRef.current;
      if (!s) return;
      e.preventDefault();
      s.orbit.distance = Math.max(30, Math.min(24_000, s.orbit.distance * Math.exp(e.deltaY * 0.0013)));
      s.interacting = true;
      s.idleFrames = 0;
      s.progressive.reset();
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        const inner = stateRef.current;
        if (inner) inner.interacting = false;
      }, 130);
    };
    let wheelTimer = 0;

    const onContextMenu = (e: Event) => e.preventDefault();

    mount.addEventListener("pointerdown", onDown);
    mount.addEventListener("pointermove", onMove);
    mount.addEventListener("pointerup", onUp);
    mount.addEventListener("pointercancel", onUp);
    mount.addEventListener("wheel", onWheel, { passive: false });
    mount.addEventListener("contextmenu", onContextMenu);

    return () => {
      mount.removeEventListener("pointerdown", onDown);
      mount.removeEventListener("pointermove", onMove);
      mount.removeEventListener("pointerup", onUp);
      mount.removeEventListener("pointercancel", onUp);
      mount.removeEventListener("wheel", onWheel);
      mount.removeEventListener("contextmenu", onContextMenu);
      window.clearTimeout(wheelTimer);
    };
  }, [ready, onSelectMass]);

  // --- Rebuild the scene when the scheme or display options change ---
  useEffect(() => {
    const s = stateRef.current;
    if (!s || !ready) return;

    if (s.build) {
      s.scene.remove(s.build.group);
      s.build.dispose();
    }

    const build = buildSchemeScene(scheme, {
      mode: settings.mode,
      showEntourage: settings.showEntourage,
      showGround: settings.showGround,
      selectedMassId,
    });
    s.scene.add(build.group);
    s.build = build;

    frameBounds(s.orbit, build.bounds, s.camera, false);
    fitShadowCamera(s.sun, build.bounds);
    s.progressive.reset();
  }, [scheme, settings.mode, settings.showEntourage, settings.showGround, selectedMassId, ready]);

  // --- Sun, sky, and exposure ---
  useEffect(() => {
    const s = stateRef.current;
    if (!s || !ready) return;

    const pos = solarPosition(settings.sun);
    const [dx, dy, dz] = sunVector(pos);
    const radius = Math.max(600, s.build ? s.build.bounds.getSize(new THREE.Vector3()).length() * 1.6 : 600);

    s.sun.position.set(dx * radius, Math.max(0.08, dy) * radius, dz * radius);
    s.sun.target.position.copy(s.build ? s.build.bounds.getCenter(new THREE.Vector3()) : new THREE.Vector3());
    s.sun.target.updateMatrixWorld();

    const lighting = sunLighting(pos.altitude);
    s.sun.color.setHex(lighting.color);
    // An overcast sky scatters the direct beam into the dome, so the key drops
    // and the ambient rises rather than the whole scene just going dark.
    s.sun.intensity = lighting.intensity * (1 - settings.overcast * 0.82);
    s.fill.intensity = 0.14 + settings.overcast * 0.7;

    s.progressive.setSun(s.sun);
    // A hazier sky means a bigger effective source, so a wider jitter cone.
    s.progressive.sunSpread = 0.02 + settings.overcast * 0.16;
    s.progressive.exposure = settings.exposure;
    s.progressive.maxSamples = settings.maxSamples;

    const env = s.sky.update({
      sunDirection: new THREE.Vector3(dx, dy, dz).normalize(),
      overcast: settings.overcast,
      exposure: 1,
    });
    // Match the haze to the sky at the horizon, warming it toward a low sun.
    if (s.scene.fog instanceof THREE.Fog) {
      const warm = Math.max(0, 1 - Math.max(0, pos.altitude) / 25);
      s.scene.fog.color
        .setHex(0xbfc9d2)
        .lerp(new THREE.Color(0xd8b48c), warm * 0.7)
        .lerp(new THREE.Color(0xb9bdc2), settings.overcast * 0.6);
    }
    // The environment map lights the scene; the dome mesh is what is seen.
    s.scene.environment = env;
    s.scene.environmentIntensity = 1;

    if (s.build) fitShadowCamera(s.sun, s.build.bounds);
    s.progressive.reset();
  }, [
    settings.sun.month, settings.sun.day, settings.sun.hour,
    settings.sun.latitude, settings.sun.longitude, settings.sun.utcOffset,
    settings.overcast, settings.exposure, settings.maxSamples, ready,
  ]);

  const applyPreset = useCallback((preset: CameraPreset) => {
    const s = stateRef.current;
    if (!s?.build) return;
    const size = s.build.bounds.getSize(new THREE.Vector3());
    const radius = Math.max(40, Math.hypot(size.x, size.z) / 2);
    const centre = s.build.bounds.getCenter(new THREE.Vector3());

    s.orbit.azimuth = preset.azimuth;
    s.orbit.elevation = preset.elevation;
    s.orbit.distance = radius * preset.distance + size.y;
    s.orbit.target.set(centre.x, s.build.bounds.min.y + size.y * preset.targetHeight, centre.z);
    s.camera.fov = preset.fov;
    s.camera.updateProjectionMatrix();
    s.progressive.reset();
  }, []);

  useImperativeHandle(
    ref,
    (): ViewportHandle => ({
      frameAll: () => {
        const s = stateRef.current;
        if (s?.build) {
          frameBounds(s.orbit, s.build.bounds, s.camera, true);
          s.progressive.reset();
        }
      },
      applyPreset,
      renderStill: async (width, height, samples, onStillProgress) => {
        const s = stateRef.current;
        if (!s) throw new Error("Viewport is not ready");
        s.renderer.shadowMap.autoUpdate = false;
        return s.progressive.renderStill(s.scene, s.camera, width, height, samples, onStillProgress);
      },
      sampleCount: () => stateRef.current?.progressive.sampleCount ?? 0,
    }),
    [applyPreset],
  );

  if (error) {
    return (
      <div className="viewport-error">
        <strong>3D view unavailable</strong>
        <p>{error}</p>
        <p>The estimate and program tools work without it.</p>
      </div>
    );
  }

  return <div ref={mountRef} className="viewport" />;
});

// ---------------------------------------------------------------------------

function applyOrbit(camera: THREE.PerspectiveCamera, orbit: Orbit): void {
  const az = (orbit.azimuth * Math.PI) / 180;
  const el = (orbit.elevation * Math.PI) / 180;
  const horizontal = Math.cos(el) * orbit.distance;
  camera.position.set(
    orbit.target.x + horizontal * Math.sin(az),
    orbit.target.y + Math.sin(el) * orbit.distance,
    orbit.target.z + horizontal * Math.cos(az),
  );
  camera.lookAt(orbit.target);
}

function frameBounds(orbit: Orbit, bounds: THREE.Box3, camera: THREE.PerspectiveCamera, keepAngles: boolean): void {
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(30, Math.hypot(size.x, size.y, size.z) / 2);

  orbit.target.set(centre.x, centre.y * 0.55, centre.z);
  orbit.distance = radius / Math.tan((camera.fov * Math.PI) / 360) * 1.25;
  if (!keepAngles) return;
  orbit.azimuth = 225;
  orbit.elevation = 22;
}

/**
 * Tighten the shadow camera onto the scene.
 * A shadow frustum sized for the whole world wastes almost all of its depth
 * precision and produces the soft, detached shadows that read as "computer".
 */
function fitShadowCamera(sun: THREE.DirectionalLight, bounds: THREE.Box3): void {
  const size = bounds.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.z) * 0.72 + size.y * 0.9 + 40;
  const cam = sun.shadow.camera;
  cam.left = -extent;
  cam.right = extent;
  cam.top = extent;
  cam.bottom = -extent;
  cam.near = 1;
  cam.far = extent * 6 + 400;
  cam.updateProjectionMatrix();
  sun.shadow.needsUpdate = true;
}

/** Hit-test the pointer against the mass groups. */
function pickMass(s: ViewportState, event: PointerEvent, mount: HTMLElement): string | null {
  if (!s.build) return null;
  const rect = mount.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, s.camera);

  const groups = [...s.build.massMeshes.entries()];
  const hits = raycaster.intersectObjects(groups.map(([, g]) => g), true);
  if (!hits.length) return null;

  // Walk up to the mass group that owns the hit mesh.
  let node: THREE.Object3D | null = hits[0].object;
  while (node && !node.name.startsWith("mass:")) node = node.parent;
  return node ? node.name.slice(5) : null;
}
