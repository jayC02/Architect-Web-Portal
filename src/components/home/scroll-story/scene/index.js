import * as THREE from "three";
import { poseAt, worlds, smooth, mix } from "../story.js";
import { createTextures, disposeTextures } from "./textures.js";
import { createSite } from "./site.js";
import { createBuilding } from "./building.js";
import { createDocuments } from "./documents.js";
import { createCameraRig } from "./camera.js";

const keys = ["paper", "sky", "ink", "grid", "model"];
const stops = worlds.map((w) => ({ at: w.at, ...Object.fromEntries(keys.map((k) => [k, new THREE.Color(w[k])])) }));
function colorsAt(p, out) {
  let i = 0;
  while (i < stops.length - 2 && p > stops[i + 1].at) i++;
  const a = stops[i],
    b = stops[i + 1],
    t = smooth((p - a.at) / (b.at - a.at));
  keys.forEach((k) => out[k].lerpColors(a[k], b[k], t));
  return out;
}

/**
 * Mounts the scene into `host`. Returns controls; the caller supplies scroll progress.
 * Throws if WebGL is unavailable, so the caller can show the static story instead.
 *
 * The look is a presentation model on tinted paper: white surfaces, ink outlines, soft
 * shadows, no glow. Colours are written straight to the screen (no tone mapping) so the
 * ground matches the paper colour exactly and the scene has no visible horizon.
 */
export function createExperience(host, { mobile, onFrame }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false });
  const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
  renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#e6edf9", 42, 150);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 900);

  // Even, shadowless fill from the sky plus one soft sun: enough shading to read the
  // form, never enough to make the white model look grey.
  const hemi = new THREE.HemisphereLight("#ffffff", "#d9dde6", 2.6);
  const sun = new THREE.DirectionalLight("#ffffff", 0.75);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 140 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  scene.add(hemi, sun, sun.target);

  const textures = createTextures();
  const site = createSite(scene, { mobile });
  const building = createBuilding(scene, { mobile });
  const documents = createDocuments(scene, textures, { mobile });
  const rig = createCameraRig(camera);

  const colors = Object.fromEntries(keys.map((k) => [k, new THREE.Color()]));
  const noon = new THREE.Color("#ffffff"),
    evening = new THREE.Color("#ffe3c2");
  let progress = 0,
    width = 1,
    height = 1,
    raf = 0,
    last = performance.now(),
    time = 0,
    running = true,
    inView = true;

  function resize() {
    width = host.clientWidth || 1;
    height = host.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!running) return;
    time += dt;
    const pose = poseAt(progress);
    colorsAt(progress, colors);

    scene.fog.color.copy(colors.paper);
    hemi.groundColor.copy(colors.paper).multiplyScalar(0.95);
    // the sun sweeps round through the day, then drops for long evening shadows
    const sweep = mix(-0.7, 2.3, progress);
    const elev = mix(0.95, 0.42, smooth(Math.max(0, progress - 0.78) / 0.22));
    sun.position.set(Math.cos(sweep) * 30, Math.sin(elev) * 40 + 4, Math.sin(sweep) * 30);
    sun.color.copy(noon).lerp(evening, pose.dusk);

    rig.update(progress, width, height, dt);
    site.update(pose, colors);
    building.update(pose, colors, time);
    documents.update(pose, colors, time, dpr);

    renderer.render(scene, camera);
    onFrame?.(pose);
  }
  raf = requestAnimationFrame(frame);

  const onVisibility = () => {
    running = !document.hidden && inView;
    last = performance.now();
  };
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    onVisibility();
  });
  visibilityObserver.observe(host);
  document.addEventListener("visibilitychange", onVisibility);
  const onPointer = (e) => {
    rig.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
  };
  if (!mobile) window.addEventListener("pointermove", onPointer, { passive: true });


  return {
    setProgress(p) {
      progress = p;
    },
    pause(v) {
      running = !v;
    },
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointer);
      site.dispose();
      building.dispose();
      documents.dispose();
      disposeTextures(textures);
      sun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
