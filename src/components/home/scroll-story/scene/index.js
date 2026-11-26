import * as THREE from "three";
import { poseAt, worlds, smooth, mix } from "../story.js";
import { createTextures, disposeTextures } from "./textures.js";
import { createSite } from "./site.js";
import { createBuilding } from "./building.js";
import { createDocuments } from "./documents.js";
import { createSection } from "./section.js";
import { createConstruction } from "./construction.js";
import { createCameraRig } from "./camera.js";
import { anchorFromRect, worldAtNdc } from "./anchor.js";

const keys = ["paper", "sky", "ink", "grid", "model"];
const stops = worlds.map((w) => ({ at: w.at, ...Object.fromEntries(keys.map((k) => [k, new THREE.Color(w[k])])) }));
// Temporary bridge from the new pose to the keys the previous scene modules read.
// Each later task deletes the keys it no longer needs; Task 7 removes this.
function legacyPose(pose) {
  return {
    ...pose,
    manual: 0,
    collapse: 0,
    ringHide: 0,
    finalRing: pose.ringFinal,
  };
}
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
export function createExperience(host, { mobile, onFrame, onContextLost, getAnchorRect }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: mobile ? "default" : "high-performance", alpha: false });
  // the building warrant section cuts the studio open
  renderer.localClippingEnabled = true;
  const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
  renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  host.appendChild(renderer.domElement);
  let contextLost = false;
  const onLost = (event) => {
    event.preventDefault();
    contextLost = true;
    running = false;
    onContextLost?.();
  };
  renderer.domElement.addEventListener("webglcontextlost", onLost);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#e6edf9", 42, 150);
  // More depth precision keeps the flat ground layers stable in the distant ending.
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 900);

  // Even, shadowless fill from the sky plus one soft sun: enough shading to read the
  // form, never enough to make the white model look grey.
  const hemi = new THREE.HemisphereLight("#ffffff", "#d9dde6", 2.6);
  const sun = new THREE.DirectionalLight("#ffffff", 0.75);
  sun.castShadow = true;
  // Cover the whole neighbourhood without losing the house's shadow detail.
  sun.shadow.mapSize.set(mobile ? 2048 : 4096, mobile ? 2048 : 4096);
  Object.assign(sun.shadow.camera, { left: -64, right: 64, top: 64, bottom: -64, near: 10, far: 260 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  scene.add(hemi, sun, sun.target);

  const textures = createTextures({ mobile });
  // Upload the sheets now, so nothing stalls the first time they fly, and their canvases are freed.
  textures.docs.forEach((map) => renderer.initTexture(map));
  const site = createSite(scene, { mobile });
  const building = createBuilding(scene, { mobile });
  const documents = createDocuments(scene, textures, { mobile });
  const section = createSection(scene, building, { mobile });
  const construction = createConstruction(scene, building, { mobile });
  const rig = createCameraRig(camera);

  // Where the Architect Pro window is, as points in the scene a fixed distance from the lens.
  const ANCHOR_DISTANCE = 9;
  const anchor = { center: new THREE.Vector3(), beside: new THREE.Vector3(), unit: 1 };
  function measureAnchor() {
    camera.updateMatrixWorld();
    const box = host.getBoundingClientRect();
    const raw = getAnchorRect?.() ?? null;
    const rect = raw && { left: raw.left - box.left, top: raw.top - box.top, width: raw.width, height: raw.height };
    const viewport = { width, height };
    const center = anchorFromRect(rect, viewport);
    let beside;
    if (!rect) beside = { x: center.x - 0.32, y: center.y };
    else if (rect.width > width * 0.6) {
      // phones: the window spans the top, so sheets wait just below it
      beside = anchorFromRect({ left: rect.left + rect.width * 0.3, top: rect.top + rect.height + height * 0.02, width: rect.width * 0.4, height: height * 0.12 }, viewport);
    } else {
      // wide screens: sheets wait to the left of the window
      beside = anchorFromRect({ left: rect.left - width * 0.1, top: rect.top + rect.height * 0.3, width: width * 0.06, height: rect.height * 0.3 }, viewport);
    }
    worldAtNdc(camera, center, ANCHOR_DISTANCE, anchor.center);
    worldAtNdc(camera, beside, ANCHOR_DISTANCE, anchor.beside);
    anchor.unit = 2 * ANCHOR_DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  }

  const sunDir = new THREE.Vector3();
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
    const pose = legacyPose(poseAt(progress));
    colorsAt(progress, colors);

    scene.fog.color.copy(colors.paper);
    hemi.groundColor.copy(colors.paper).multiplyScalar(0.95);
    // the sun sweeps round through the day, then drops for long evening shadows
    const sweep = mix(-0.7, 2.3, progress) + Math.PI * 4 * smooth(Math.min(1, Math.max(0, (progress - 0.52) / 0.12)));
    const elev = mix(0.95, 0.42, smooth(Math.max(0, progress - 0.78) / 0.22));
    // Keep every street block between the light and the ground as the sun moves.
    sunDir.set(Math.cos(sweep) * 30, Math.sin(elev) * 40 + 4, Math.sin(sweep) * 30).normalize();
    sun.position.copy(sunDir).multiplyScalar(120);
    sun.color.copy(noon).lerp(evening, pose.dusk);

    rig.update(progress, width, height, dt);
    site.update(pose, colors, camera.position, rig.target, dt);
    building.update(pose, colors, time);
    // only measured while something is flying to the window
    const flying = pose.sheets.some((g) => g.t > 0 && g.t < 1) || (pose.section.explode > 0 && pose.section.uvalue < 1);
    if (flying) measureAnchor();
    documents.update(pose, colors, time, dpr, anchor, camera);
    section.update(pose, colors, time, anchor, camera);
    construction.update(pose, colors);

    renderer.render(scene, camera);
    onFrame?.(pose);
  }
  raf = requestAnimationFrame(frame);

  const onVisibility = () => {
    running = !document.hidden && inView && !contextLost;
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
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      observer.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointer);
      site.dispose();
      building.dispose();
      documents.dispose();
      section.dispose();
      construction.dispose();
      disposeTextures(textures);
      sun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
