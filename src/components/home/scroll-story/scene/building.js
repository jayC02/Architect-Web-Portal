import * as THREE from "three";
import { ribbon, ribbonMaterial, arcSegments } from "./lines.js";
import { inkMaterial, inkLines, inkEdges, mergedBoxes } from "./ink.js";
import { clamp, mix } from "../story.js";

// 14 Harbour Lane: a fictional three-storey house. Units are metres.
const T = 0.3; // wall thickness
const H = 3; // storey height
const A = { x0: -5, x1: 5, z0: -3.25, z1: 3.25 }; // ground + first floor
const B = { x0: -1, x1: 5, z0: -3.25, z1: 3.25 }; // top-floor studio, set back for a terrace

const W = (o) => o; // readability helper for wall specs
const win = (a, b, sill = 0.9, head = 2.4) => ({ a, b, sill, head });
const glazed = (a, b) => ({ a, b, sill: 0.1, head: 2.65 });
const door = (a, b) => ({ a, b, sill: 0, head: 2.2, door: true });

function outerWalls(f, openings) {
  return [
    // `out` is which way the outside face points along the wall's normal
    W({ axis: "x", at: f.z1 - T / 2, from: f.x0, to: f.x1, out: 1, open: openings.front ?? [] }),
    W({ axis: "x", at: f.z0 + T / 2, from: f.x0, to: f.x1, out: -1, open: openings.back ?? [] }),
    W({ axis: "z", at: f.x0 + T / 2, from: f.z0 + T, to: f.z1 - T, out: -1, open: openings.left ?? [] }),
    W({ axis: "z", at: f.x1 - T / 2, from: f.z0 + T, to: f.z1 - T, out: 1, open: openings.right ?? [] }),
  ];
}
const storeys = [
  {
    y: 0,
    walls: [
      ...outerWalls(A, {
        front: [glazed(-4.2, -0.8), door(1.9, 2.9), win(3.5, 4.4, 0.9, 2.3)],
        back: [glazed(-3, 3)],
        left: [win(-1.2, 1.4, 0.9, 2.3)],
        right: [win(-2, -0.6, 0.9, 2.3)],
      }),
      W({ axis: "x", at: 0.4, from: -4.7, to: 0.85, open: [door(-1.4, -0.5)], inner: true }),
      W({ axis: "z", at: 1, from: -2.95, to: 2.95, open: [door(1.0, 1.9)], inner: true }),
      W({ axis: "z", at: -2, from: 0.55, to: 2.95, open: [], inner: true }),
    ],
  },
  {
    y: H,
    walls: [
      ...outerWalls(A, {
        front: [win(-4.2, -2.6), win(-1.6, 0), win(1.2, 4.2)],
        back: [win(-4.2, -2.2), win(0, 2.6)],
        left: [win(-1.6, 1.6)],
        right: [],
      }),
      W({ axis: "x", at: -0.2, from: -4.7, to: 4.7, open: [door(-3.2, -2.3), door(2.4, 3.3)], inner: true }),
      W({ axis: "z", at: 0, from: -0.05, to: 2.95, open: [], inner: true }),
    ],
  },
  {
    y: H * 2,
    walls: outerWalls(B, {
      front: [win(-0.4, 4.4, 0.3, 2.65)],
      back: [win(-0.4, 1.6)],
      left: [glazed(-2.6, 2.6)],
      right: [win(-1, 1, 0.9, 2.3)],
    }),
  },
];

/** Split a wall into solid boxes around its openings, plus one glass pane per window. */
function wallPieces(wall) {
  const pieces = [],
    panes = [];
  const add = (a, b, y0, y1) => {
    if (b - a < 0.01 || y1 - y0 < 0.01) return;
    const c = (a + b) / 2;
    const box = { len: b - a, h: y1 - y0, y: (y0 + y1) / 2 };
    pieces.push(wall.axis === "x" ? { ...box, x: c, z: wall.at, rot: 0 } : { ...box, x: wall.at, z: c, rot: Math.PI / 2 });
  };
  const open = [...wall.open].sort((p, q) => p.a - q.a);
  let cursor = wall.from;
  open.forEach((o) => {
    add(cursor, o.a, 0, H);
    add(o.a, o.b, 0, o.sill);
    add(o.a, o.b, o.head, H);
    if (!o.door) {
      const c = (o.a + o.b) / 2;
      const pane = { len: o.b - o.a, h: o.head - o.sill, y: (o.sill + o.head) / 2 };
      panes.push(wall.axis === "x" ? { ...pane, x: c, z: wall.at, rot: 0 } : { ...pane, x: wall.at, z: c, rot: Math.PI / 2 });
    }
    cursor = o.b;
  });
  add(cursor, wall.to, 0, H);
  return { pieces, panes };
}

/** The ground-floor plan as drawable ribbons: walls, glazing, door swings, dimensions. */
function planSegments() {
  const walls = [],
    details = [];
  storeys[0].walls.forEach((wall) => {
    const half = wall.inner ? T * 0.33 : T / 2;
    const open = [...wall.open].sort((p, q) => p.a - q.a);
    const spans = [];
    let cursor = wall.from;
    open.forEach((o) => {
      spans.push([cursor, o.a]);
      cursor = o.b;
    });
    spans.push([cursor, wall.to]);
    const seg = (u0, u1, off) =>
      wall.axis === "x" ? [u0, wall.at + off, u1, wall.at + off] : [wall.at + off, u0, wall.at + off, u1];
    spans.forEach(([u0, u1]) => {
      if (u1 - u0 < 0.01) return;
      walls.push(seg(u0, u1, -half), seg(u0, u1, half));
      // close the ends of each wall run
      [u0, u1].forEach((u) =>
        walls.push(wall.axis === "x" ? [u, wall.at - half, u, wall.at + half] : [wall.at - half, u, wall.at + half, u]),
      );
    });
    open.forEach((o) => {
      if (o.door) {
        const len = o.b - o.a;
        if (wall.axis === "x") {
          details.push(...arcSegments(o.a, wall.at, len, 0, Math.PI / 2));
          details.push([o.a, wall.at, o.a, wall.at + len]);
        } else {
          details.push(...arcSegments(wall.at, o.a, len, Math.PI / 2, Math.PI));
          details.push([wall.at, o.a, wall.at - len, o.a]);
        }
      } else {
        details.push(seg(o.a, o.b, -0.05), seg(o.a, o.b, 0.05));
      }
    });
  });
  // dimension line along the front
  const dz = A.z1 + 1.4;
  details.push([A.x0, dz, A.x1, dz], [A.x0, dz - 0.3, A.x0, dz + 0.3], [A.x1, dz - 0.3, A.x1, dz + 0.3], [0, dz - 0.2, 0, dz + 0.2]);
  const dx = A.x1 + 1.4;
  details.push([dx, A.z0, dx, A.z1], [dx - 0.3, A.z0, dx + 0.3, A.z0], [dx - 0.3, A.z1, dx + 0.3, A.z1]);
  // north point
  details.push([7, -5.6, 7.5, -4.2], [7.5, -4.2, 8, -5.6], [7.5, -4.2, 7.5, -6.2]);
  return { walls, details };
}

const EPS = 0.014; // lines sit just proud of the surface they describe
const FRONT_DOOR = { a: 1.9, b: 2.9, head: 2.2 };

/** Ink for one outside wall: its outline and openings (strong), and its cladding texture (faint). */
function wallInk(wall, storey) {
  const strong = [],
    faint = [];
  if (wall.inner) return { strong, faint };
  const off = wall.at + wall.out * (T / 2 + EPS);
  const ext = wall.axis === "z" ? T : 0; // side walls stop short of the corners; their outline doesn't
  const P = (u, y) => (wall.axis === "x" ? [u, y, off] : [off, y, u]);
  const seg = (arr, u0, y0, u1, y1) => arr.push(...P(u0, y0), ...P(u1, y1));
  const a = wall.from - ext,
    b = wall.to + ext;
  seg(strong, a, 0, a, H);
  seg(strong, b, 0, b, H);
  seg(strong, a, H, b, H);
  wall.open.forEach((o) => {
    seg(strong, o.a, o.sill, o.a, o.head);
    seg(strong, o.b, o.sill, o.b, o.head);
    seg(strong, o.a, o.head, o.b, o.head);
    seg(strong, o.a, o.sill, o.b, o.sill);
  });
  if (storey === 2) {
    // vertical timber boards on the studio
    for (let u = a + 0.3; u < b - 0.1; u += 0.3) {
      const o = wall.open.find((o) => u > o.a && u < o.b);
      if (!o) seg(faint, u, 0, u, H);
      else {
        if (o.sill > 0.05) seg(faint, u, 0, u, o.sill);
        seg(faint, u, o.head, u, H);
      }
    }
  } else {
    // coursing lines on the rendered masonry below
    for (let y = 0.6; y < H - 0.1; y += 0.6) {
      let cursor = a;
      [...wall.open]
        .sort((p, q) => p.a - q.a)
        .forEach((o) => {
          if (y > o.sill && y < o.head) {
            seg(faint, cursor, y, o.a, y);
            cursor = o.b;
          }
        });
      seg(faint, cursor, y, b, y);
    }
  }
  return { strong, faint };
}

/** Window frames, mullions, transoms and cills for one wall, as boxes in world space. */
function wallJoinery(wall, y0) {
  const out = [];
  if (wall.inner) return out;
  const box = (u, y, d, su, sy, sd) =>
    out.push(wall.axis === "x" ? { x: u, y: y0 + y, z: d, sx: su, sy, sz: sd } : { x: d, y: y0 + y, z: u, sx: sd, sy, sz: su });
  const F = 0.07,
    D = 0.14,
    plane = wall.at + wall.out * 0.04;
  wall.open.forEach((o) => {
    const w = o.b - o.a,
      h = o.head - o.sill,
      mid = (o.a + o.b) / 2,
      cy = (o.sill + o.head) / 2;
    box(o.a + F / 2, cy, plane, F, h, D);
    box(o.b - F / 2, cy, plane, F, h, D);
    box(mid, o.head - F / 2, plane, w, F, D);
    if (o.door) return;
    box(mid, o.sill + F / 2, plane, w, F, D);
    const panels = Math.max(1, Math.round(w / 1.15));
    for (let i = 1; i < panels; i++) box(o.a + (w * i) / panels, cy, plane, 0.05, h, D * 0.8);
    if (h > 2) box(mid, o.sill + 2.05, plane, w, 0.05, D * 0.8);
    // projecting cill
    if (o.sill > 0.3) box(mid, o.sill - 0.03, wall.at + wall.out * 0.1, w + 0.16, 0.06, T + 0.2);
  });
  return out;
}

export function createBuilding(scene) {
  const owned = [];
  const own = (o) => (owned.push(o), o);
  const root = new THREE.Group();
  scene.add(root);

  // --- Pens
  const ink = own(inkMaterial(1.7, 1));
  const inkFaint = own(inkMaterial(1, 0.26));
  const child = (lines) => (owned.push(lines.geometry), lines);

  // --- Plan drawing on the ground
  const plan = planSegments();
  const planWalls = new THREE.Mesh(own(ribbon(plan.walls, 0.075, 0.035)), own(ribbonMaterial("#1d3f9e", 1)));
  const planDetail = new THREE.Mesh(own(ribbon(plan.details, 0.04, 0.035)), own(ribbonMaterial("#1d3f9e", 0.9)));
  root.add(planWalls, planDetail);

  // --- Model surfaces. Pushed back a hair in depth so the ink always wins.
  const surface = (extra = {}) => own(new THREE.MeshLambertMaterial({ color: "#ffffff", polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...extra }));
  const lowerMat = surface();
  const upperMat = surface();
  const slabMat = surface();
  const roofMat = surface({ transparent: true });
  const frameMat = surface({ transparent: true });
  const doorMat = surface({ transparent: true });
  const glassMat = own(new THREE.MeshBasicMaterial({ color: "#a9c6e6", transparent: true, opacity: 0, depthWrite: false }));
  const unitBox = own(new THREE.BoxGeometry(1, 1, 1));
  const shadowed = (mesh) => ((mesh.castShadow = mesh.receiveShadow = true), mesh);

  const wallGroups = []; // [{group, storey, order}]
  const glazing = [[], [], []]; // per storey: things that appear with the windows
  storeys.forEach((storey, s) => {
    const joinery = [];
    storey.walls.forEach((wall, w) => {
      const group = new THREE.Group();
      group.position.y = storey.y;
      const { pieces, panes } = wallPieces(wall);
      pieces.forEach((p) => {
        const mesh = shadowed(new THREE.Mesh(unitBox, s === 2 ? upperMat : lowerMat));
        mesh.scale.set(p.len, p.h, wall.inner ? T * 0.66 : T);
        mesh.position.set(p.x, p.y, p.z);
        mesh.rotation.y = p.rot;
        group.add(mesh);
      });
      const lines = wallInk(wall, s);
      if (lines.strong.length) group.add(child(inkLines(lines.strong, ink)), child(inkLines(lines.faint, inkFaint)));
      panes.forEach((p) => {
        const pane = new THREE.Mesh(unitBox, glassMat);
        pane.scale.set(p.len - 0.1, p.h - 0.1, 0.03);
        pane.position.set(p.x, storey.y + p.y, p.z);
        pane.rotation.y = p.rot;
        pane.renderOrder = 1;
        root.add(pane);
        glazing[s].push(pane);
      });
      joinery.push(...wallJoinery(wall, storey.y));
      root.add(group);
      wallGroups.push({ group, storey: s, order: w / storey.walls.length });
    });
    const frames = shadowed(new THREE.Mesh(own(mergedBoxes(joinery)), frameMat));
    root.add(frames);
    glazing[s].push(frames);
  });

  // Front door, canopy and step
  const frontZ = A.z1 - T / 2;
  const doorMid = (FRONT_DOOR.a + FRONT_DOOR.b) / 2;
  const door = shadowed(new THREE.Mesh(unitBox, doorMat));
  door.scale.set(FRONT_DOOR.b - FRONT_DOOR.a - 0.14, FRONT_DOOR.head - 0.07, 0.07);
  door.position.set(doorMid, (FRONT_DOOR.head - 0.07) / 2, frontZ - 0.02);
  const doorInk = child(
    inkLines(
      [
        // two recessed panels and a handle
        ...[-0.22, 0.22].flatMap((dx) => [dx - 0.15, 0.3, 0, dx - 0.15, -0.36, 0, dx + 0.15, 0.3, 0, dx + 0.15, -0.36, 0, dx - 0.15, 0.3, 0, dx + 0.15, 0.3, 0, dx - 0.15, -0.36, 0, dx + 0.15, -0.36, 0]),
        0.4, -0.02, 0, 0.4, -0.12, 0,
      ].map((v, i) => (i % 3 === 2 ? 0.52 : v)),
      ink,
    ),
  );
  door.add(doorInk);
  const canopy = shadowed(new THREE.Mesh(unitBox, slabMat));
  canopy.scale.set(1.9, 0.08, 1);
  canopy.position.set(doorMid, FRONT_DOOR.head + 0.28, A.z1 + 0.45);
  const step = shadowed(new THREE.Mesh(unitBox, slabMat));
  step.scale.set(1.7, 0.14, 0.7);
  step.position.set(doorMid, 0.07, A.z1 + 0.35);
  [canopy, step].forEach((m) => m.add(child(inkEdges(unitBox, ink))));
  root.add(door, canopy, step);
  glazing[0].push(door, canopy, step);

  // Plinth
  const plinth = shadowed(new THREE.Mesh(unitBox, slabMat));
  plinth.scale.set(A.x1 - A.x0 + 0.24, 0.16, A.z1 - A.z0 + 0.24);
  plinth.add(child(inkEdges(unitBox, ink)));
  root.add(plinth);

  // Floor slabs
  const slabs = [
    { y: H, f: A },
    { y: H * 2, f: A },
  ].map(({ y, f }) => {
    const mesh = shadowed(new THREE.Mesh(unitBox, slabMat));
    mesh.scale.set(f.x1 - f.x0 + 0.3, 0.3, f.z1 - f.z0 + 0.3);
    mesh.position.set((f.x0 + f.x1) / 2, y, 0);
    mesh.add(child(inkEdges(unitBox, ink)));
    root.add(mesh);
    return { mesh, y };
  });

  // Pitched zinc roof over the studio, with standing seams
  const eave = B.z1 + 0.35,
    ridge = 2.3;
  const profile = new THREE.Shape();
  profile.moveTo(-eave, 0);
  profile.lineTo(0, ridge);
  profile.lineTo(eave, 0);
  profile.lineTo(-eave, 0);
  const roofLen = B.x1 - B.x0 + 0.5;
  const roofGeo = own(new THREE.ExtrudeGeometry(profile, { depth: roofLen, bevelEnabled: false }));
  roofGeo.rotateY(Math.PI / 2);
  roofGeo.translate(B.x0 - 0.25, 0, 0);
  const roof = shadowed(new THREE.Mesh(roofGeo, roofMat));
  const seams = [];
  for (let x = B.x0 - 0.25 + 0.55; x < B.x0 - 0.25 + roofLen - 0.2; x += 0.55) {
    seams.push(x, EPS, -eave, x, ridge + EPS, 0, x, ridge + EPS, 0, x, EPS, eave);
  }
  roof.add(child(inkEdges(roofGeo, ink)), child(inkLines(seams, inkFaint)));
  root.add(roof);

  // Roof terrace: glass balustrade and decking
  const rail = [];
  [
    [A.x0, B.x0, A.z1 - 0.1, 0],
    [A.x0, B.x0, A.z0 + 0.1, 0],
    [A.z0, A.z1, A.x0 + 0.1, 1],
  ].forEach(([a, b, at, axis]) => {
    const pane = new THREE.Mesh(unitBox, glassMat);
    pane.scale.set(b - a, 1.05, 0.04);
    pane.position.set(axis ? at : (a + b) / 2, H * 2 + 0.68, axis ? (a + b) / 2 : at);
    pane.rotation.y = axis ? Math.PI / 2 : 0;
    pane.renderOrder = 1;
    pane.add(child(inkEdges(unitBox, ink)));
    root.add(pane);
    rail.push(pane);
  });
  const boards = [];
  for (let x = A.x0 + 0.3; x < B.x0 - 0.2; x += 0.3) boards.push(x, H * 2 + 0.15 + EPS, A.z0 + 0.2, x, H * 2 + 0.15 + EPS, A.z1 - 0.2);
  const decking = child(inkLines(boards, inkFaint));
  root.add(decking);

  // --- Automation layer: a scan plane and the section it is reading
  const scanMat = own(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uAmount: { value: 0 }, uColor: { value: new THREE.Color("#5a3df0") }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uAmount; uniform vec3 uColor; uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          float fade = smoothstep(1.0, 0.2, r);
          vec2 g = abs(fract(p * 14.0) - 0.5);
          float grid = smoothstep(0.47, 0.5, max(g.x, g.y));
          float ring = smoothstep(0.03, 0.0, abs(fract(r * 3.0 - uTime * 0.4) - 0.5) - 0.46);
          float a = fade * (0.06 + grid * 0.3 + ring * 0.22) * uAmount;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    }),
  );
  const scan = new THREE.Mesh(own(new THREE.PlaneGeometry(34, 34)), scanMat);
  scan.rotation.x = -Math.PI / 2;
  scan.renderOrder = 4;
  root.add(scan);

  const contourMat = own(new THREE.MeshBasicMaterial({ color: "#5a3df0", transparent: true, opacity: 0, depthWrite: false }));
  const contour = new THREE.Group();
  const bar = own(new THREE.BoxGeometry(1, 0.07, 0.07));
  const bars = [0, 1, 2, 3].map(() => {
    const m = new THREE.Mesh(bar, contourMat);
    contour.add(m);
    return m;
  });
  contour.renderOrder = 5;
  root.add(contour);
  const setContour = (f) => {
    const w = f.x1 - f.x0 + 0.5,
      d = f.z1 - f.z0 + 0.5,
      cx = (f.x0 + f.x1) / 2;
    bars[0].scale.x = bars[1].scale.x = w;
    bars[2].scale.x = bars[3].scale.x = d;
    bars[0].position.set(cx, 0, f.z1 + 0.25);
    bars[1].position.set(cx, 0, f.z0 - 0.25);
    bars[2].position.set(f.x0 - 0.25, 0, 0);
    bars[3].position.set(f.x1 + 0.25, 0, 0);
    bars[2].rotation.y = bars[3].rotation.y = Math.PI / 2;
  };

  // The finished house: pale render, timber studio, zinc roof, a blue front door.
  const finish = {
    lower: new THREE.Color("#f6f1e7"),
    upper: new THREE.Color("#c99d6f"),
    roof: new THREE.Color("#8f9aa8"),
    slab: new THREE.Color("#e4e5e3"),
    frame: new THREE.Color("#2c3444"),
    door: new THREE.Color("#2747a8"),
  };
  const glassDay = new THREE.Color("#a9c6e6"),
    glassScan = new THREE.Color("#b7a9ff"),
    glassLit = new THREE.Color("#ffd27a");

  function update(pose, colors, time) {
    ink.color.copy(colors.ink);
    inkFaint.color.copy(colors.ink);

    planWalls.material.uniforms.uReveal.value = pose.plan;
    planDetail.material.uniforms.uReveal.value = clamp(pose.plan * 1.3 - 0.3);
    const planFade = 1 - clamp(pose.walls[0] * 1.2);
    planWalls.material.uniforms.uOpacity.value = 0.2 + 0.8 * planFade;
    planDetail.material.uniforms.uOpacity.value = 0.7 * planFade;
    planWalls.material.uniforms.uColor.value.copy(colors.ink);
    planDetail.material.uniforms.uColor.value.copy(colors.ink);
    planDetail.visible = planFade > 0.01;
    planWalls.visible = pose.built < 0.5;

    wallGroups.forEach(({ group, storey, order }) => {
      const rise = clamp(pose.walls[storey] * 1.5 - order * 0.5);
      group.scale.y = Math.max(0.0001, rise);
      group.visible = rise > 0.0005;
    });
    const base = clamp(pose.walls[0] * 4);
    plinth.scale.y = Math.max(0.0001, 0.16 * base);
    plinth.position.y = 0.08 * base;
    plinth.visible = base > 0.001;
    slabs.forEach(({ mesh, y }, i) => {
      const s = pose.slabs[i];
      mesh.position.y = y + (1 - s) * 7;
      mesh.visible = s > 0.001;
      mesh.scale.x = mix(6, A.x1 - A.x0 + 0.3, s);
    });
    roof.position.y = H * 3 + (1 - pose.roof) * 6;
    roof.visible = pose.roof > 0.001;
    roofMat.opacity = clamp(pose.roof * 2);
    decking.visible = pose.slabs[1] > 0.98;

    // white model → finished materials
    const f = pose.built;
    lowerMat.color.copy(colors.model).lerp(finish.lower, f);
    upperMat.color.copy(colors.model).lerp(finish.upper, f);
    slabMat.color.copy(colors.model).lerp(finish.slab, f);
    roofMat.color.copy(colors.model).lerp(finish.roof, f);
    frameMat.color.copy(colors.model).lerp(colors.ink, 0.55).lerp(finish.frame, f);
    doorMat.color.copy(colors.model).lerp(finish.door, f);
    inkFaint.opacity = mix(0.26, 0.4, f);

    // windows go in, then light up as the day ends
    const g = pose.glazing;
    frameMat.opacity = doorMat.opacity = g;
    glassMat.color.copy(glassDay).lerp(glassScan, pose.ai).lerp(glassLit, pose.dusk);
    glassMat.opacity = g * mix(0.55, 0.92, Math.max(f * 0.4, pose.dusk));
    glazing.forEach((items, s) => items.forEach((item) => (item.visible = pose.walls[s] > 0.95 && g > 0.001)));
    rail.forEach((p) => (p.visible = pose.slabs[1] > 0.95 && g > 0.001));

    // the scan
    const ai = pose.ai;
    const y = mix(0.2, 11.2, pose.scan);
    scan.position.y = y;
    scanMat.uniforms.uAmount.value = ai * (1 - Math.max(0, pose.scan - 0.96) * 25);
    scanMat.uniforms.uTime.value = time;
    scan.visible = ai > 0.01 && pose.scan < 0.999;
    contour.position.y = y;
    setContour(y > H * 2 + 0.2 ? B : A);
    contourMat.opacity = ai * (y < 9.2 ? 1 : 0);
    contour.visible = scan.visible;
  }

  return {
    update,
    dispose() {
      owned.forEach((o) => o.dispose());
      scene.remove(root);
    },
  };
}
