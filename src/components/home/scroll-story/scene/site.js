import * as THREE from "three";
import { ribbon, ribbonMaterial } from "./lines.js";
import { withBoxInk, inkMaterial, inkEdges } from "./ink.js";
import { clamp, mix, MANUAL_MIN, AUTO_MIN } from "../story.js";

export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PLOT = { x0: -9, x1: 9, z0: -7.5, z1: 8 };
const ROAD_Z = 12;

export function createSite(scene, { mobile }) {
  const owned = [];
  const own = (o) => (owned.push(o), o);
  const group = new THREE.Group();
  scene.add(group);
  const lambert = (color, extra = {}) => own(new THREE.MeshLambertMaterial({ color, ...extra }));

  // Sky: the paper colour at the horizon, a touch deeper overhead.
  const sky = new THREE.Mesh(
    own(new THREE.SphereGeometry(400, 32, 16)),
    own(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uTop: { value: new THREE.Color() }, uPaper: { value: new THREE.Color() } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop; uniform vec3 uPaper;
          varying vec3 vDir;
          void main() {
            gl_FragColor = vec4(mix(uPaper, uTop, smoothstep(0.02, 0.7, vDir.y)), 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    ),
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  // Ground: flat paper, plus a transparent layer that only shows shadows.
  const groundGeo = own(new THREE.PlaneGeometry(700, 700));
  const groundMat = own(new THREE.MeshBasicMaterial({ color: "#e6edf9" }));
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  const flat = { depthWrite: false, polygonOffset: true };
  const shadowMat = own(new THREE.ShadowMaterial({ color: "#1b2a4a", opacity: 0.17, ...flat, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
  const shadows = new THREE.Mesh(groundGeo, shadowMat);
  shadows.rotation.x = -Math.PI / 2;
  shadows.position.y = 0.02;
  shadows.receiveShadow = true;
  // Flat ground layers are drawn in a fixed order, without writing depth, so they can
  // never flicker against each other or swap places with the window glass.
  shadows.renderOrder = -3;
  group.add(ground, shadows);

  // Drafting grid: minor + major lines
  const gridVerts = [];
  const majorVerts = [];
  const extent = 70;
  for (let i = -extent; i <= extent; i += 1) {
    const target = i % 5 === 0 ? majorVerts : gridVerts;
    target.push(-extent, 0, i, extent, 0, i, i, 0, -extent, i, 0, extent);
  }
  const gridGeo = own(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(gridVerts, 3)));
  const majorGeo = own(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(majorVerts, 3)));
  const gridMat = own(new THREE.LineBasicMaterial({ color: "#9db4e3", transparent: true, opacity: 0.3, depthWrite: false }));
  const majorMat = own(new THREE.LineBasicMaterial({ color: "#9db4e3", transparent: true, opacity: 0.6, depthWrite: false }));
  const grid = new THREE.LineSegments(gridGeo, gridMat);
  const major = new THREE.LineSegments(majorGeo, majorMat);
  grid.position.y = major.position.y = 0.006;
  grid.renderOrder = major.renderOrder = -5;
  group.add(grid, major);

  // The red line: the planning-application site boundary.
  const { x0, x1, z0, z1 } = PLOT;
  const red = new THREE.Mesh(
    own(ribbon([[x0, z1, x0, z0], [x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1]], 0.2, 0.03)),
    own(ribbonMaterial("#e23b2e", 1)),
  );
  group.add(red);

  // Lawn, path and hedges arrive with the finished house.
  const softInk = own(inkMaterial(1.2, 0.55));
  const lawnMat = lambert("#dcebc9", { transparent: true, opacity: 0, ...flat, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const lawn = new THREE.Mesh(own(new THREE.PlaneGeometry(x1 - x0, z1 - z0)), lawnMat);
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2);
  lawn.renderOrder = -4; // shadows land on it from the layer above
  const unit = own(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const pathMat = lambert("#f4f1ea");
  const hedgeMat = lambert("#86b872");
  const garden = [
    [pathMat, 2.4, 5.75, 1.3, 0.05, 3.5],
    [hedgeMat, -3.7, 7.55, 9.8, 0.75, 0.6],
    [hedgeMat, 6.05, 7.55, 5.1, 0.75, 0.6],
    [hedgeMat, -8.55, 0.4, 0.6, 0.75, 13.6],
    [hedgeMat, 8.55, 0.4, 0.6, 0.75, 13.6],
  ].map(([mat, x, z, sx, sy, sz]) => {
    const mesh = new THREE.Mesh(unit, mat);
    mesh.position.set(x, 0, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = mesh.receiveShadow = true;
    const edges = inkEdges(unit, softInk);
    owned.push(edges.geometry);
    mesh.add(edges);
    group.add(mesh);
    return { mesh, sy };
  });
  group.add(lawn);

  // Road and pavement
  const roadMat = lambert("#d9dfea", { transparent: true, ...flat, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const road = new THREE.Mesh(own(new THREE.PlaneGeometry(170, 5)), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.012, ROAD_Z);
  road.renderOrder = -4;
  const kerbMat = lambert("#ffffff", { transparent: true });
  const kerb = new THREE.Mesh(own(new THREE.BoxGeometry(170, 0.12, 2.2)), kerbMat);
  kerb.position.set(0, 0.06, ROAD_Z - 3.6);
  kerb.receiveShadow = true;
  group.add(road, kerb);

  // Neighbouring streets as a white massing model. Outlines are drawn in the shader.
  const rand = seeded(1402);
  const blocks = [];
  for (let gx = -63; gx <= 63; gx += 7) {
    for (let gz = -56; gz <= 56; gz += 7) {
      const cx = gx + (rand() - 0.5) * 1.5,
        cz = gz + (rand() - 0.5) * 1.5;
      if (Math.abs(cx) < 15 && cz > -13 && cz < 18) continue; // our plot & its street
      if (Math.abs(cz - ROAD_Z) < 5.5) continue; // road
      if (rand() < 0.12) continue;
      const far = Math.hypot(cx, cz);
      blocks.push({
        x: cx,
        z: cz,
        w: 3.6 + rand() * 2.4,
        d: 3.6 + rand() * 2.4,
        h: 2.6 + rand() * 3 + Math.min(far / 12, 4) * rand(),
        tone: rand(),
      });
    }
  }
  const cityInk = { value: new THREE.Color() };
  const cityInkAmount = { value: 0.6 };
  const cityMat = withBoxInk(lambert("#ffffff"), cityInk, cityInkAmount);
  const city = new THREE.InstancedMesh(unit, cityMat, blocks.length);
  city.castShadow = !mobile;
  city.receiveShadow = true;
  const tint = new THREE.Color();
  blocks.forEach((b, i) => city.setColorAt(i, tint.setScalar(0.95 + b.tone * 0.05)));
  group.add(city);

  // Trees: a scattering through the neighbourhood from the start, then the garden and street.
  const trees = [];
  const tr = seeded(99);
  const clear = (x, z) => blocks.every((b) => Math.abs(x - b.x) > b.w / 2 + 1 || Math.abs(z - b.z) > b.d / 2 + 1);
  for (let tries = 0; tries < 900 && trees.length < 80; tries++) {
    const x = (tr() - 0.5) * 120,
      z = (tr() - 0.5) * 108;
    if (Math.abs(x) < 24 && z > -20 && z < 27) continue; // keep the camera's close-ups clear
    if (Math.abs(z - ROAD_Z) < 5.5 || !clear(x, z)) continue;
    trees.push({ x, z, s: 0.6 + tr() * 0.45, garden: false });
  }
  const addTree = (x, z, s) => trees.push({ x, z, s, garden: true });
  for (let i = 0; i < 6; i++) {
    let x = mix(x0 + 1.6, x1 - 1.6, tr());
    if (Math.abs(x - 2.4) < 1.5) x -= 3; // keep the front path clear
    addTree(x, mix(5, z1 - 1.4, tr()), 0.6 + tr() * 0.4);
  }
  for (let i = 0; i < 5; i++) addTree(mix(x0 + 1.6, x1 - 1.6, tr()), mix(z0 + 1.2, -4.8, tr()), 0.75 + tr() * 0.5);
  for (let x = -38; x <= 38; x += 6.5) addTree(x + tr(), ROAD_Z - 4.1, 0.9 + tr() * 0.4);
  const canopyMat = lambert("#ffffff", { flatShading: true });
  const trunkMat = lambert("#8a7358");
  const canopy = new THREE.InstancedMesh(own(new THREE.IcosahedronGeometry(1.1, 0).translate(0, 2.6, 0)), canopyMat, trees.length);
  const trunk = new THREE.InstancedMesh(own(new THREE.CylinderGeometry(0.09, 0.13, 1.8, 6).translate(0, 0.9, 0)), trunkMat, trees.length);
  canopy.castShadow = trunk.castShadow = true;
  const leafA = new THREE.Color("#86bd6f"),
    leafB = new THREE.Color("#5f9c58");
  trees.forEach((_, i) => canopy.setColorAt(i, tint.copy(leafA).lerp(leafB, tr())));
  group.add(canopy, trunk);

  // Street lamps
  const lampXs = [];
  for (let x = -44; x <= 44; x += 11) lampXs.push(x + 5.5);
  const poleMat = lambert("#aeb5c2");
  const bulbMat = own(new THREE.MeshBasicMaterial({ color: "#ffcf73", transparent: true, opacity: 0 }));
  const poles = new THREE.InstancedMesh(own(new THREE.CylinderGeometry(0.04, 0.06, 3.4, 6).translate(0, 1.7, 0)), poleMat, lampXs.length);
  const bulbs = new THREE.InstancedMesh(own(new THREE.SphereGeometry(0.2, 10, 8).translate(0, 3.45, 0)), bulbMat, lampXs.length);
  const m = new THREE.Matrix4();
  lampXs.forEach((x, i) => {
    m.makeTranslation(x, 0, ROAD_Z - 2.9);
    poles.setMatrixAt(i, m);
    bulbs.setMatrixAt(i, m);
  });
  group.add(poles, bulbs);

  // The minute ring: one segment per minute in the portal. 30 by hand, 3 with ArchitectPro.
  const MINUTES = Math.round(MANUAL_MIN),
    KEEP = Math.round(AUTO_MIN),
    ringR = 12.6,
    arc = (Math.PI * 2) / MINUTES;
  const ring = new THREE.Group();
  ring.position.y = 0.05;
  ring.rotation.x = -Math.PI / 2;
  const ringRed = new THREE.Color("#e5452f"),
    ringKept = new THREE.Color("#5a3df0"),
    ringGold = new THREE.Color("#e3a11f");
  const segments = [];
  for (let i = 0; i < MINUTES; i++) {
    // clockwise from twelve o'clock, as seen from above
    const start = Math.PI / 2 - (i + 1) * arc + arc * 0.08;
    const geo = own(new THREE.RingGeometry(ringR - 0.42, ringR + 0.42, 12, 1, start, arc * 0.84));
    const mat = own(new THREE.MeshBasicMaterial({ color: ringRed, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3;
    ring.add(mesh);
    segments.push(mesh);
  }
  group.add(ring);

  const dummy = new THREE.Object3D();
  let lastCity = -1,
    lastTrees = -1;

  // Clear sight lines. Any block or tree that sits between the camera and what it is
  // looking at, or right beside the lens, sinks into the ground and rises again once the
  // camera has passed. Without this, phone framing (which steps the camera back) can put a
  // neighbouring building in front of the lens.
  const blockVis = new Float32Array(blocks.length).fill(1),
    treeVis = new Float32Array(trees.length).fill(1);
  const dir = new THREE.Vector3();
  function segmentHitsBox(o, d, min, max) {
    let t0 = 0,
      t1 = 1;
    for (const k of ["x", "y", "z"]) {
      if (Math.abs(d[k]) < 1e-6) {
        if (o[k] < min[k] || o[k] > max[k]) return false;
        continue;
      }
      let a = (min[k] - o[k]) / d[k],
        b = (max[k] - o[k]) / d[k];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return false;
    }
    return true;
  }
  const bmin = new THREE.Vector3(),
    bmax = new THREE.Vector3();
  function clearSightLines(cam, look, dt) {
    dir.subVectors(look, cam);
    const k = 1 - Math.exp(-dt * 7);
    let changed = false;
    blocks.forEach((b, i) => {
      const pad = 0.8;
      bmin.set(b.x - b.w / 2 - pad, 0, b.z - b.d / 2 - pad);
      bmax.set(b.x + b.w / 2 + pad, b.h + pad, b.z + b.d / 2 + pad);
      const near = Math.max(bmin.x - cam.x, 0, cam.x - bmax.x) ** 2 + Math.max(bmin.y - cam.y, 0, cam.y - bmax.y) ** 2 + Math.max(bmin.z - cam.z, 0, cam.z - bmax.z) ** 2 < 36;
      const want = near || segmentHitsBox(cam, dir, bmin, bmax) ? 0 : 1;
      const v = blockVis[i] + (want - blockVis[i]) * k;
      if (Math.abs(v - blockVis[i]) > 1e-4) changed = true;
      blockVis[i] = Math.abs(v - want) < 1e-3 ? want : v;
    });
    trees.forEach((t, i) => {
      const r = 2.2 * t.s + 0.6;
      bmin.set(t.x - r, 0, t.z - r);
      bmax.set(t.x + r, 3.8 * t.s + 0.6, t.z + r);
      const near = Math.hypot(t.x - cam.x, t.z - cam.z) < 4 && cam.y < 6;
      // the garden and street trees are part of the picture: they only move for the lens itself
      const want = near || (!t.garden && segmentHitsBox(cam, dir, bmin, bmax)) ? 0 : 1;
      const v = treeVis[i] + (want - treeVis[i]) * k;
      if (Math.abs(v - treeVis[i]) > 1e-4) changed = true;
      treeVis[i] = Math.abs(v - want) < 1e-3 ? want : v;
    });
    return changed;
  }

  function update(pose, colors, cam, look, dt = 0.016) {
    const sightChanged = cam ? clearSightLines(cam, look, dt) : false;
    sky.material.uniforms.uTop.value.copy(colors.sky);
    sky.material.uniforms.uPaper.value.copy(colors.paper);
    groundMat.color.copy(colors.paper);
    shadowMat.color.copy(colors.ink);
    softInk.color.copy(colors.ink);
    gridMat.color.copy(colors.grid);
    majorMat.color.copy(colors.grid);
    gridMat.opacity = 0.34 * pose.grid;
    majorMat.opacity = 0.7 * pose.grid;
    grid.visible = major.visible = pose.grid > 0.02;

    red.material.uniforms.uReveal.value = pose.redline;
    red.material.uniforms.uOpacity.value = mix(1, 0.5, pose.built);

    const streetIn = clamp(pose.city * 1.6 - 0.1);
    roadMat.opacity = kerbMat.opacity = streetIn;
    road.visible = kerb.visible = streetIn > 0.01;
    roadMat.color.copy(colors.paper).multiplyScalar(0.93);
    kerbMat.color.copy(colors.model);

    cityMat.color.copy(colors.model);
    cityInk.value.copy(colors.ink);
    if (sightChanged || Math.abs(pose.city - lastCity) > 1e-4) {
      lastCity = pose.city;
      blocks.forEach((b, i) => {
        const stagger = clamp(pose.city * 1.25 - b.tone * 0.25);
        dummy.position.set(b.x, 0, b.z);
        // a block that has fully stepped aside leaves no footprint either
        const gone = blockVis[i] < 0.02 ? 0 : 1;
        dummy.scale.set(b.w * gone, Math.max(0.05, b.h * stagger * blockVis[i]) * gone, b.d * gone);
        dummy.updateMatrix();
        city.setMatrixAt(i, dummy.matrix);
      });
      city.instanceMatrix.needsUpdate = true;
    }

    const context = clamp(pose.city * 3.4 - 0.25),
      planted = pose.built;
    if (sightChanged || Math.abs(context + planted * 10 - lastTrees) > 1e-4) {
      lastTrees = context + planted * 10;
      trees.forEach((t, i) => {
        const g = t.garden ? clamp(planted * 1.4 - (i % 7) * 0.05) : clamp(context * 1.3 - (i % 5) * 0.06);
        dummy.position.set(t.x, 0, t.z);
        dummy.scale.setScalar(Math.max(0.001, t.s * g * treeVis[i]));
        dummy.rotation.y = i * 1.7;
        dummy.updateMatrix();
        canopy.setMatrixAt(i, dummy.matrix);
        trunk.setMatrixAt(i, dummy.matrix);
      });
      canopy.instanceMatrix.needsUpdate = trunk.instanceMatrix.needsUpdate = true;
      dummy.rotation.y = 0;
    }
    // leaves pick up a little of the paper colour so each act stays in one key
    canopyMat.color.setScalar(1).lerp(colors.paper, 0.3);

    lawnMat.opacity = planted * 0.9;
    lawn.visible = planted > 0.01;
    garden.forEach(({ mesh, sy }, i) => {
      const g = clamp(planted * 1.5 - i * 0.08);
      mesh.scale.y = Math.max(0.0001, sy * g);
      mesh.visible = g > 0.001;
    });

    // minute ring
    segments.forEach((seg, i) => {
      const mat = seg.material;
      const lit = clamp(pose.manual * MINUTES - i); // ticks round while you do it by hand
      let opacity = lit;
      mat.color.copy(ringRed);
      if (i < KEEP) mat.color.lerp(ringKept, pose.collapse);
      else opacity *= 1 - pose.collapse; // the rest simply disappear
      opacity *= 1 - pose.ringHide;
      // the ending brings it back: the kept minutes in gold, the saved ones as faint outlines
      const f = pose.finalRing;
      if (f > 0) {
        mat.color.lerp(ringGold, f);
        opacity = Math.max(opacity, f * (i < KEEP ? 1 : 0.16));
      }
      mat.opacity = opacity;
      seg.visible = mat.opacity > 0.005;
      seg.scale.setScalar(1 + (i < KEEP ? 0 : pose.collapse * (1 - f) * 0.15));
    });

    poles.visible = bulbs.visible = streetIn > 0.5;
    bulbMat.opacity = pose.dusk;
  }

  return {
    update,
    dispose() {
      owned.forEach((o) => o.dispose());
      scene.remove(group);
    },
  };
}
