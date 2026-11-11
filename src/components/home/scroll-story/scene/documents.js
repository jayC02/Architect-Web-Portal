import * as THREE from "three";
import { clamp, mix, smooth, win } from "../story.js";
import { seeded } from "./site.js";

const SHEET_W = 1.6,
  SHEET_H = 2.26;
const BOARD = { y: 15.6, z: -6.5, gap: 1.95, row: 2.62, tilt: 0.2 };
const GROUP_X = [-4.75, 4.75]; // planning permission, building warrant
const STACK_X = GROUP_X.map((x) => x * 0.75);
const STACK_Y = 12.6,
  STACK_Z = -3.2;
// When each application is submitted, validated and approved (scroll progress). Matches the side panel.
const STATUS = [
  [0.655, 0.69, 0.72],
  [0.67, 0.705, 0.735],
];
const STATUS_NAMES = ["Submitted", "Validated", "Approved"];
const ROW_LABELS = ["Planning permission", "Building warrant"];
const PORTAL_HOME = new THREE.Vector3(0, 13.8, 2.8);
const PORTAL_AWAY = new THREE.Vector3(0, 19.5, -26);
const statusColors = [new THREE.Color("#f0a51a"), new THREE.Color("#2b7de0"), new THREE.Color("#0d9a78")];

function slot(i) {
  const g = Math.floor(i / 12),
    k = i % 12,
    c = k % 4,
    r = Math.floor(k / 4);
  const x = GROUP_X[g] + (c - 1.5) * BOARD.gap;
  const y = BOARD.y + (1 - r) * BOARD.row;
  return { g, k, x, y, z: BOARD.z - Math.abs(x) * 0.1 + (1 - r) * Math.sin(BOARD.tilt) * BOARD.row * 0.5 };
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,1)");
  grad.addColorStop(0.36, "rgba(255,255,255,0.28)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createDocuments(scene, textures, { mobile }) {
  const owned = [];
  const own = (o) => (owned.push(o), o);
  const root = new THREE.Group();
  scene.add(root);
  const sheetGeo = own(new THREE.PlaneGeometry(SHEET_W, SHEET_H));
  const backMat = own(new THREE.MeshLambertMaterial({ color: "#ffffff" }));
  const badgeGeo = own(new THREE.PlaneGeometry(0.52, 0.52));
  const rand = seeded(2026);

  const sheets = [];
  const make = (map, i, noise) => {
    // the paper carries a little self-light so sheets stay legible whatever the sun is doing
    const front = own(
      new THREE.MeshBasicMaterial({ map, transparent: noise }),
    );
    const group = new THREE.Group();
    const face = new THREE.Mesh(sheetGeo, front);
    const back = new THREE.Mesh(sheetGeo, backMat);
    back.rotation.y = Math.PI;
    face.castShadow = back.castShadow = !mobile;
    group.add(face, back);
    const sheet = {
      group,
      front,
      noise,
      index: i,
      r: 7.5 + rand() * 8,
      h: 1.2 + rand() * 11,
      a0: rand() * Math.PI * 2,
      dir: rand() > 0.35 ? 1 : -1,
      tumble: new THREE.Vector3(rand() * 6, rand() * 6, rand() * 6),
      tumbleSpeed: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.8),
      seed: rand(),
    };
    if (!noise) {
      sheet.slot = slot(i);
      const m = own(new THREE.MeshBasicMaterial({ map: textures.prepared, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      sheet.badge = new THREE.Mesh(badgeGeo, m);
      sheet.badge.position.set(SHEET_W / 2 - 0.12, SHEET_H / 2 - 0.12, 0.03);
      sheet.badge.renderOrder = 6;
      group.add(sheet.badge);
    }
    root.add(group);
    sheets.push(sheet);
  };
  textures.docs.forEach((map, i) => make(map, i, false));
  // the noise appears twice over: it really is everywhere
  [...textures.noise, ...textures.noise].forEach((map, i) => make(map, i, true));

  // Board labels, one per application
  const labels = textures.labels.map((map, g) => {
    const m = own(new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    const mesh = new THREE.Mesh(own(new THREE.PlaneGeometry(5.6, 1.1)), m);
    mesh.position.set(GROUP_X[g] - 0.9, BOARD.y + BOARD.row * 1.5 + 0.75, BOARD.z - Math.abs(GROUP_X[g]) * 0.1 + 0.2);
    mesh.rotation.x = -BOARD.tilt;
    root.add(mesh);
    return mesh;
  });

  // --- Tracking: submission beams, status beacons and the calendar
  const glowTex = own(glowTexture());
  const beamMat = own(new THREE.MeshBasicMaterial({ color: "#0d9a78", transparent: true, opacity: 0, depthWrite: false }));
  const beamGeo = own(new THREE.CylinderGeometry(0.03, 0.12, 70, 10, 1, true).translate(0, 35, 0));
  const tracked = STACK_X.map((x) => {
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(x, STACK_Y + 0.5, STACK_Z);
    const beacon = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false })));
    beacon.position.set(x, STACK_Y + 2.1, STACK_Z);
    const tickMat = own(new THREE.SpriteMaterial({ map: textures.approved, transparent: true, opacity: 0, depthWrite: false }));
    const tick = new THREE.Sprite(tickMat);
    tick.position.set(x, STACK_Y + 2.1, STACK_Z + 0.1);
    tick.scale.setScalar(0.9);
    root.add(beam, beacon, tick);
    return { beam, beacon, tick, color: new THREE.Color() };
  });

  // The portal: a frustrating screen while you do it by hand, a distant one when it runs in the background.
  const PANEL_W = 7.4,
    PANEL_H = (PANEL_W * 720) / 1024;
  // kept below the bloom threshold so the screen stays readable
  const portalMat = own(new THREE.MeshBasicMaterial({ map: textures.portal.map, transparent: true, opacity: 0, toneMapped: false, side: THREE.DoubleSide }));
  const portal = new THREE.Mesh(own(new THREE.PlaneGeometry(PANEL_W, PANEL_H)), portalMat);
  portal.renderOrder = 7;
  const haloMat = own(new THREE.MeshBasicMaterial({ color: "#5a3df0", transparent: true, opacity: 0, depthWrite: false }));
  const halo = new THREE.Mesh(own(new THREE.PlaneGeometry(PANEL_W * 1.08, PANEL_H * 1.1)), haloMat);
  halo.position.z = -0.05;
  portal.add(halo);
  root.add(portal);

  // The project record ArchitectPro keeps, shown while it tracks the applications.
  const recordMat = own(new THREE.MeshBasicMaterial({ map: textures.record.map, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  const record = new THREE.Mesh(own(new THREE.PlaneGeometry(8.6, (8.6 * 720) / 1024)), recordMat);
  record.position.set(0, 16.4, -7.4);
  record.rotation.x = -BOARD.tilt;
  root.add(record);

  // Data stream from the model to the board while ArchitectPro reads it
  const count = mobile ? 500 : 1100;
  const start = new Float32Array(count * 3),
    end = new Float32Array(count * 3),
    seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    start[i * 3] = mix(-5, 5, rand());
    start[i * 3 + 1] = mix(0.5, 10, rand());
    start[i * 3 + 2] = mix(-3.3, 3.3, rand());
    const s = slot(Math.floor(rand() * 24));
    end[i * 3] = s.x + (rand() - 0.5) * SHEET_W;
    end[i * 3 + 1] = s.y + (rand() - 0.5) * SHEET_H;
    end[i * 3 + 2] = s.z + 0.05;
    seed[i] = rand();
  }
  const streamGeo = own(new THREE.BufferGeometry());
  streamGeo.setAttribute("position", new THREE.BufferAttribute(start, 3));
  streamGeo.setAttribute("aEnd", new THREE.BufferAttribute(end, 3));
  streamGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const streamMat = own(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uAmount: { value: 0 },
        uScale: { value: 1 },
        uA: { value: new THREE.Color("#5a3df0") },
        uB: { value: new THREE.Color("#2b7de0") },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aEnd; attribute float aSeed;
        uniform float uTime; uniform float uAmount; uniform float uScale;
        varying float vT;
        void main() {
          float t = fract(aSeed * 13.7 + uTime * (0.16 + aSeed * 0.22));
          vec3 p = mix(position, aEnd, smoothstep(0.0, 1.0, t));
          float lift = sin(t * 3.14159);
          p.y += lift * (2.5 + aSeed * 3.0);
          p.x += sin(t * 6.283 + aSeed * 30.0) * 0.6 * lift;
          p.z += lift * 3.5;
          vT = t;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.9 + aSeed * 1.3) * lift * uAmount * uScale * (60.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uA; uniform vec3 uB; uniform float uAmount;
        varying float vT;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d) * uAmount;
          gl_FragColor = vec4(mix(uA, uB, vT), a * 0.7);
          #include <colorspace_fragment>
        }`,
    }),
  );
  const stream = new THREE.Points(streamGeo, streamMat);
  stream.frustumCulled = false;
  root.add(stream);

  // scratch
  const pos = new THREE.Vector3(),
    chaosPos = new THREE.Vector3(),
    boardPos = new THREE.Vector3(),
    packPos = new THREE.Vector3(),
    storePos = new THREE.Vector3(),
    qa = new THREE.Quaternion(),
    e = new THREE.Euler(),
    origin = new THREE.Vector3(0, 4.5, 0);
  const scanTint = new THREE.Color("#cfc6ff");
  const boardQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-BOARD.tilt, 0, 0));
  const flatQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0, 0));

  function update(pose, colors, time, pixelRatio) {
    const { docs, order, noise, prepared, pack, submit, store, ai, p } = pose;
    root.visible = docs > 0.001;
    streamMat.uniforms.uTime.value = time;
    streamMat.uniforms.uAmount.value = ai * clamp(pose.scan * 4) * (1 - clamp((pose.scan - 0.9) * 10));
    streamMat.uniforms.uScale.value = pixelRatio * (mobile ? 1.4 : 1);
    stream.visible = streamMat.uniforms.uAmount.value > 0.01;

    sheets.forEach((s, n) => {
      // swirling storm of paperwork
      const ang = s.a0 + (p - 0.3) * 9 * s.dir + time * 0.07 * s.dir;
      const wob = Math.sin(time * 0.7 + s.seed * 20) * 0.35;
      chaosPos.set(Math.cos(ang) * s.r, s.h + wob, Math.sin(ang) * s.r);
      e.set(s.tumble.x + time * s.tumbleSpeed.x + p * 6, s.tumble.y + time * s.tumbleSpeed.y + p * 5, s.tumble.z + time * s.tumbleSpeed.z);
      qa.setFromEuler(e);
      const burst = clamp(docs * 1.5 - s.seed * 0.5);
      pos.copy(origin).lerp(chaosPos, smooth(burst));
      let scale = burst;

      if (s.noise) {
        // automation clears the noise away
        pos.multiplyScalar(1 + noise * 2.4);
        pos.y += noise * 10;
        scale *= 1 - noise;
        s.front.opacity = 1 - noise;
      } else {
        const { g, k } = s.slot;
        const so = smooth(clamp(order * 1.35 - k * 0.04 - g * 0.03));
        boardPos.set(s.slot.x, s.slot.y, s.slot.z);
        pos.lerp(boardPos, so);
        qa.slerp(boardQuat, so);
        if (pack > 0) {
          // each application becomes one neat stack
          packPos.set(STACK_X[g], STACK_Y + k * 0.04, STACK_Z + k * 0.03);
          const sp = smooth(clamp(pack * 1.3 - k * 0.035));
          pos.lerp(packPos, sp);
          qa.slerp(flatQuat, sp);
        }
        if (store > 0) {
          // and is filed away in the project record
          storePos.set(STACK_X[g] * 0.25, 4.5, 0);
          const st = smooth(clamp(store * 1.3 - k * 0.03));
          pos.lerp(storePos, st);
          scale *= 1 - st;
        }
        // "prepared" badges as automation reaches each document
        const pi = clamp(prepared * 1.6 - (s.index / 24) * 0.6);
        s.badge.material.opacity = pi * (1 - pack);
        s.badge.scale.setScalar(mix(0.2, 1, smooth(pi)) * (1 + Math.sin(time * 4 + n) * 0.05));
        s.badge.visible = s.badge.material.opacity > 0.01;
        const flash = Math.max(0, 1 - Math.abs(pi - 0.5) * 2);
        s.front.color.setScalar(1).lerp(scanTint, flash * ai * 0.55);
      }
      s.group.quaternion.copy(qa);
      s.group.position.copy(pos);
      s.group.scale.setScalar(Math.max(0.0001, scale));
      s.group.visible = scale > 0.002;
    });

    labels.forEach((l) => {
      l.material.opacity = clamp(order * 2 - 1) * (1 - pack);
      l.visible = l.material.opacity > 0.01;
    });

    // submissions shoot up, then status beacons step amber → blue → green
    const away = 1 - store;
    const flare = Math.sin(clamp(submit) * Math.PI);
    beamMat.opacity = (flare * 0.5 + clamp(submit * 3) * 0.1) * away;
    tracked.forEach((t, g) => {
      t.beam.visible = beamMat.opacity > 0.01;
      t.beam.scale.y = mix(0.05, 1, smooth(clamp(submit * 1.4 - g * 0.15)));
      const [s0, s1, s2] = STATUS[g];
      const level = p < s1 ? 0 : p < s2 ? 1 : 2;
      t.color.copy(statusColors[level]);
      t.beacon.material.color.copy(t.color);
      const on = clamp((p - s0) * 60) * away;
      const approvedPop = clamp((p - s2) * 50);
      t.beacon.material.opacity = on * (0.6 + Math.sin(time * 5 + g) * 0.08);
      t.beacon.scale.setScalar((1.5 + approvedPop * 0.6) * (1 - store * 0.8));
      t.beacon.visible = t.beacon.material.opacity > 0.01;
      t.tick.material.opacity = approvedPop * away;
      t.tick.visible = t.tick.material.opacity > 0.01;
    });

    // --- portal screen
    const m = pose.manual,
      fill = pose.portalFill;
    if (fill > 0) {
      textures.portal.draw({
        auto: true,
        title: fill < 0.5 ? "Planning permission application" : "Building warrant application",
        page: Math.min(14, 4 + Math.round(fill * 10)),
        filled: Math.min(6, Math.round(fill * 9)),
        uploads: Math.min(9, Math.round(fill * 14)),
        pay: fill >= 0.65 && fill < 1,
        submitted: fill >= 1,
      });
    } else {
      const planning = m < 0.75;
      const t = planning ? m / 0.75 : (m - 0.75) / 0.25;
      textures.portal.draw({
        auto: false,
        title: planning ? "Planning permission application" : "Building warrant application",
        page: planning ? 1 + Math.floor(t * 4.99) : 1,
        filled: planning ? Math.min(6, Math.floor(t * 7)) : Math.floor(t * 2.5),
        uploads: planning ? Math.min(9, Math.floor(Math.max(0, t - 0.45) * 14)) : 0,
      });
    }
    const recede = smooth(pose.portalAway);
    portal.position.lerpVectors(PORTAL_HOME, PORTAL_AWAY, recede);
    portal.scale.setScalar(Math.max(0.001, mix(0.6, 1, smooth(pose.portal)) * mix(1, 0.62, recede)));
    portal.rotation.x = mix(-0.04, -0.12, recede);
    portalMat.opacity = pose.portal * (1 - pack);
    haloMat.opacity = recede * 0.3 * (0.75 + Math.sin(time * 3) * 0.25) * (1 - pack);
    portal.visible = portalMat.opacity > 0.01;

    // --- project record
    const recOn = pose.record * (1 - win(p, 0.77, 0.8));
    recordMat.opacity = recOn;
    record.visible = recOn > 0.01;
    record.position.y = 16.4 + (1 - pose.record) * -1.5;
    if (record.visible) {
      textures.record.draw({
        rows: ROW_LABELS.map((label, g) => {
          const [s0, s1, s2] = STATUS[g];
          return [label, p < s0 ? "Waiting" : STATUS_NAMES[p < s1 ? 0 : p < s2 ? 1 : 2]];
        }),
        saved: p >= 0.76,
      });
    }

    backMat.color.copy(colors.model);
  }

  return {
    update,
    dispose() {
      owned.forEach((o) => o.dispose());
      scene.remove(root);
    },
  };
}
