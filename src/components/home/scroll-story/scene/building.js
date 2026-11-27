import * as THREE from "three";
import { ribbon, ribbonMaterial, arcSegments } from "./lines.js";
import { inkMaterial, inkLines, inkEdges, mergedBoxes } from "./ink.js";
import { clamp, mix, smooth, win as span } from "../story.js";

// 14 Harbour Lane: a fictional two-storey house (storeys 0 and 1, existing) gaining a
// second-floor timber studio with a roof terrace (storey 2, the proposal). Units are metres.
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

/** The proposed studio plan as drawable ribbons: walls, glazing, dimensions. */
function planSegments() {
  const walls = [],
    details = [];
  storeys[2].walls.forEach((wall) => {
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
  // dimension lines, and the terrace outline in front of the studio
  const dz = B.z1 + 0.9;
  details.push([B.x0, dz, B.x1, dz], [B.x0, dz - 0.25, B.x0, dz + 0.25], [B.x1, dz - 0.25, B.x1, dz + 0.25]);
  const dx = B.x1 + 0.9;
  details.push([dx, B.z0, dx, B.z1], [dx - 0.25, B.z0, dx + 0.25, B.z0], [dx - 0.25, B.z1, dx + 0.25, B.z1]);
  details.push([A.x0 + 0.1, A.z0 + 0.1, A.x0 + 0.1, A.z1 - 0.1], [A.x0 + 0.1, A.z1 - 0.1, B.x0, A.z1 - 0.1], [A.x0 + 0.1, A.z0 + 0.1, B.x0, A.z0 + 0.1]);
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

  // The section cut through the studio: everything in front of it (towards the street) is clipped away.
  const cut = new THREE.Plane(new THREE.Vector3(0, 0, -1), 10);
  const clippingPlanes = [cut];

  // --- Pens. The house is first sketched, storey by storey, as a new design: each pen draws
  // its lines like strokes, then the house becomes the model and its ink goes quieter.
  // The extension is drawn in full ink.
  const strokePen = (width, opacity) => {
    const m = own(inkMaterial(width, opacity));
    m.dashed = true;
    m.gapSize = 10;
    m.dashSize = 2;
    return m;
  };
  const sketch = [0, 1].map(() => ({ strong: strokePen(1.4, 0.85), faint: strokePen(1, 0.2) }));
  const inkOld = sketch[0].strong;
  const ink = strokePen(1.7, 1);
  const inkFaint = strokePen(1, 0.26);
  ink.clippingPlanes = inkFaint.clippingPlanes = clippingPlanes;
  const child = (lines) => (owned.push(lines.geometry), lines);
  /** Lines a pen draws in: distances run 0 to 1 along each set, so every set takes the same time. */
  const stroked = (lines) => {
    lines.computeLineDistances();
    const data = lines.geometry.attributes.instanceDistanceStart.data;
    const total = Math.max(1e-6, ...data.array);
    for (let i = 0; i < data.array.length; i++) data.array[i] /= total;
    data.needsUpdate = true;
    return child(lines);
  };

  // --- The proposed studio plan, inked onto the existing flat roof
  const plan = planSegments();
  const PLAN_Y = H * 2 + 0.17;
  const planWalls = new THREE.Mesh(own(ribbon(plan.walls, 0.075, PLAN_Y)), own(ribbonMaterial("#1d3f9e", 1)));
  const planDetail = new THREE.Mesh(own(ribbon(plan.details, 0.04, PLAN_Y)), own(ribbonMaterial("#1d3f9e", 0.9)));
  root.add(planWalls, planDetail);

  // --- Model surfaces. Pushed back a hair in depth so the ink always wins.
  const surface = (extra = {}) => own(new THREE.MeshLambertMaterial({ color: "#ffffff", polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...extra }));
  const lowerMat = surface();
  const upperMat = surface({ clippingPlanes, side: THREE.DoubleSide });
  const slabMat = surface();
  const roofMat = surface({ transparent: true, clippingPlanes, side: THREE.DoubleSide });
  const frameMat = surface();
  const frameNewMat = surface({ transparent: true, clippingPlanes });
  const doorMat = surface();
  const glassMat = own(new THREE.MeshBasicMaterial({ color: "#a9c6e6", transparent: true, opacity: 0.6, depthWrite: false }));
  const glassNewMat = own(new THREE.MeshBasicMaterial({ color: "#a9c6e6", transparent: true, opacity: 0, depthWrite: false, clippingPlanes }));
  const unitBox = own(new THREE.BoxGeometry(1, 1, 1));
  const shadowed = (mesh) => ((mesh.castShadow = mesh.receiveShadow = true), mesh);

  const wallGroups = []; // the studio walls: [{group, order}]
  const glazing = []; // the studio windows, frames and terrace glass
  storeys.forEach((storey, s) => {
    const proposed = s === 2;
    const joinery = [];
    storey.walls.forEach((wall, w) => {
      const group = new THREE.Group();
      group.position.y = storey.y;
      const { pieces, panes } = wallPieces(wall);
      pieces.forEach((p) => {
        const mesh = shadowed(new THREE.Mesh(unitBox, proposed ? upperMat : lowerMat));
        mesh.scale.set(p.len, p.h, wall.inner ? T * 0.66 : T);
        mesh.position.set(p.x, p.y, p.z);
        mesh.rotation.y = p.rot;
        group.add(mesh);
      });
      const lines = wallInk(wall, s);
      if (lines.strong.length) {
        if (proposed) group.add(stroked(inkLines(lines.strong, ink)), stroked(inkLines(lines.faint, inkFaint)));
        else group.add(stroked(inkLines(lines.strong, sketch[s].strong)), stroked(inkLines(lines.faint, sketch[s].faint)));
      }
      panes.forEach((p) => {
        const pane = new THREE.Mesh(unitBox, proposed ? glassNewMat : glassMat);
        pane.scale.set(p.len - 0.1, p.h - 0.1, 0.03);
        pane.position.set(p.x, storey.y + p.y, p.z);
        pane.rotation.y = p.rot;
        pane.renderOrder = 2;
        root.add(pane);
        if (proposed) glazing.push(pane);
      });
      joinery.push(...wallJoinery(wall, storey.y));
      root.add(group);
      if (proposed) wallGroups.push({ group, order: w / storey.walls.length });
    });
    const frames = shadowed(new THREE.Mesh(own(mergedBoxes(joinery)), proposed ? frameNewMat : frameMat));
    root.add(frames);
    if (proposed) glazing.push(frames);
  });

  // Front door, canopy and step
  const frontZ = A.z1 - T / 2;
  const doorMid = (FRONT_DOOR.a + FRONT_DOOR.b) / 2;
  const door = shadowed(new THREE.Mesh(unitBox, doorMat));
  door.scale.set(FRONT_DOOR.b - FRONT_DOOR.a - 0.14, FRONT_DOOR.head - 0.07, 0.07);
  door.position.set(doorMid, (FRONT_DOOR.head - 0.07) / 2, frontZ - 0.02);
  const doorInk = stroked(
    inkLines(
      [
        // two recessed panels and a handle
        ...[-0.22, 0.22].flatMap((dx) => [dx - 0.15, 0.3, 0, dx - 0.15, -0.36, 0, dx + 0.15, 0.3, 0, dx + 0.15, -0.36, 0, dx - 0.15, 0.3, 0, dx + 0.15, 0.3, 0, dx - 0.15, -0.36, 0, dx + 0.15, -0.36, 0]),
        0.4, -0.02, 0, 0.4, -0.12, 0,
      ].map((v, i) => (i % 3 === 2 ? 0.52 : v)),
      inkOld,
    ),
  );
  door.add(doorInk);
  const canopy = shadowed(new THREE.Mesh(unitBox, slabMat));
  canopy.scale.set(1.9, 0.08, 1);
  canopy.position.set(doorMid, FRONT_DOOR.head + 0.28, A.z1 + 0.45);
  const step = shadowed(new THREE.Mesh(unitBox, slabMat));
  step.scale.set(1.7, 0.14, 0.7);
  step.position.set(doorMid, 0.07, A.z1 + 0.35);
  [canopy, step].forEach((m) => m.add(stroked(inkEdges(unitBox, inkOld))));
  root.add(door, canopy, step);

  // Plinth
  const plinth = shadowed(new THREE.Mesh(unitBox, slabMat));
  plinth.scale.set(A.x1 - A.x0 + 0.24, 0.16, A.z1 - A.z0 + 0.24);
  plinth.position.y = 0.08;
  plinth.add(stroked(inkEdges(unitBox, inkOld)));
  root.add(plinth);

  // Floor slabs
  const slabs = [
    { y: H, f: A, pen: sketch[0].strong },
    { y: H * 2, f: A, pen: sketch[1].strong },
  ].map(({ y, f, pen }) => {
    const mesh = shadowed(new THREE.Mesh(unitBox, slabMat));
    mesh.scale.set(f.x1 - f.x0 + 0.3, 0.3, f.z1 - f.z0 + 0.3);
    mesh.position.set((f.x0 + f.x1) / 2, y, 0);
    mesh.add(stroked(inkEdges(unitBox, pen)));
    root.add(mesh);
    return mesh;
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
  roof.add(stroked(inkEdges(roofGeo, ink)), stroked(inkLines(seams, inkFaint)));
  root.add(roof);

  // Roof terrace: glass balustrade and decking
  const rail = [];
  [
    [A.x0, B.x0, A.z1 - 0.1, 0],
    [A.x0, B.x0, A.z0 + 0.1, 0],
    [A.z0, A.z1, A.x0 + 0.1, 1],
  ].forEach(([a, b, at, axis]) => {
    const pane = new THREE.Mesh(unitBox, glassNewMat);
    pane.scale.set(b - a, 1.05, 0.04);
    pane.position.set(axis ? at : (a + b) / 2, H * 2 + 0.68, axis ? (a + b) / 2 : at);
    pane.rotation.y = axis ? Math.PI / 2 : 0;
    pane.renderOrder = 2;
    pane.add(stroked(inkEdges(unitBox, ink)));
    root.add(pane);
    rail.push(pane);
  });
  const boards = [];
  for (let x = A.x0 + 0.3; x < B.x0 - 0.2; x += 0.3) boards.push(x, H * 2 + 0.15 + EPS, A.z0 + 0.2, x, H * 2 + 0.15 + EPS, A.z1 - 0.2);
  const decking = stroked(inkLines(boards, inkFaint));
  root.add(decking);

  // The existing house's surfaces: hidden while it is a sketch, then faded in as the model.
  const oldMats = [lowerMat, slabMat, frameMat, doorMat];
  const oldMeshes = [];
  root.traverse((o) => o.isMesh && oldMats.includes(o.material) && oldMeshes.push(o));
  // and the extension's walls and roof, which go the same way: sketch first, then the model
  const studioMeshes = [roof, ...wallGroups.flatMap(({ group }) => group.children.filter((o) => o.isMesh && !o.isLineSegments2))];
  /** See-through while a sketch: drawn first, so the lines behind it stay hidden. */
  const fade = (mats, meshes, amount) => {
    mats.forEach((m) => {
      const see = amount < 0.999;
      if (m.transparent !== see) {
        m.transparent = see;
        m.needsUpdate = true;
      }
    });
    meshes.forEach((m) => {
      m.castShadow = amount > 0.5;
      m.renderOrder = amount < 0.999 ? -1 : 0;
    });
  };

  // Once it is the model, the existing house wears its finished render. The studio is a white
  // presentation model until it is built.
  const finish = {
    lower: new THREE.Color("#f6f1e7"),
    upper: new THREE.Color("#c99d6f"),
    roof: new THREE.Color("#8f9aa8"),
    slab: new THREE.Color("#e4e5e3"),
    frame: new THREE.Color("#2c3444"),
    door: new THREE.Color("#2747a8"),
  };
  const grey = new THREE.Color("#8b93a3");
  const glassDay = new THREE.Color("#a9c6e6"),
    glassLit = new THREE.Color("#ffd27a");
  const CUT_FAR = 10,
    CUT_AT = 0.35;

  function update(pose, colors) {
    const studio = pose.studio;
    const built = pose.built;
    // construction: the white model goes, and the real studio rises in its place
    const c = pose.construction;
    const onSite = pose.p >= 0.5;
    const cleared = span(pose.p, 0.5, 0.525);
    // in planning the extension stands full height as soon as it is sketched; its pen draws it in
    const sketched = studio.draw > 0.001 ? 1 : 0;
    const walls = !onSite ? sketched : pose.p < 0.545 ? 1 - cleared : c.storey;
    const roofUp = !onSite ? sketched : pose.p < 0.545 ? 1 - cleared : c.roof;
    const timber = onSite && pose.p >= 0.545 ? 1 : built;
    // the house sketched storey by storey, each pen drawing its strokes; once it is the model
    // its ink goes quieter than the extension's until the whole house is one again
    const house = pose.house;
    ink.color.copy(colors.ink);
    inkFaint.color.copy(colors.ink);
    sketch.forEach((pen, s) => {
      const drawn = house.draw[s];
      pen.strong.color.copy(colors.ink).lerp(grey, 0.55 * (1 - built) * house.solid);
      pen.faint.color.copy(pen.strong.color);
      [pen.strong, pen.faint].forEach((m) => {
        m.dashSize = drawn >= 1 ? 2 : drawn;
        m.visible = drawn > 0.001;
      });
      pen.strong.opacity = mix(1, 0.85, house.solid);
    });
    // the sketch becomes the model: surfaces fade in, and cast shadows once they read as solid
    const solid = house.solid;
    fade(oldMats, oldMeshes, solid);
    oldMats.forEach((m) => (m.opacity = solid));
    // the extension's pens, then its model
    [ink, inkFaint].forEach((m) => {
      m.dashSize = studio.draw >= 1 ? 2 : studio.draw;
      m.visible = studio.draw > 0.001;
    });
    fade([upperMat], studioMeshes, studio.solid);
    upperMat.opacity = studio.solid;
    // until it starts to become the model, the extension is lines only, so the plan beneath stays readable
    const studioSolid = studio.solid > 0.001;
    studioMeshes.forEach((m) => m !== roof && (m.visible = studioSolid));
    roofMat.depthWrite = studioSolid;

    // the studio plan inks itself onto the roof, then fades as the walls go up
    planWalls.material.uniforms.uReveal.value = pose.plan;
    planDetail.material.uniforms.uReveal.value = clamp(pose.plan * 1.3 - 0.3);
    const planFade = 1 - clamp(studio.solid * 1.4);
    planWalls.material.uniforms.uOpacity.value = planFade;
    planDetail.material.uniforms.uOpacity.value = 0.75 * planFade;
    planWalls.material.uniforms.uColor.value.copy(colors.ink);
    planDetail.material.uniforms.uColor.value.copy(colors.ink);
    planWalls.visible = planDetail.visible = pose.plan > 0.001 && planFade > 0.01;

    wallGroups.forEach(({ group, order }) => {
      const rise = clamp(walls * 1.5 - order * 0.5);
      group.scale.y = Math.max(0.0001, rise);
      group.visible = rise > 0.0005;
    });
    // the roof grows up from the wall tops, like the walls
    roof.position.y = H * 3;
    roof.scale.y = Math.max(0.0001, roofUp);
    roof.visible = roofUp > 0.001;
    roofMat.opacity = clamp(roofUp * 2) * studio.solid;
    decking.visible = studio.terrace > 0.5;
    rail.forEach((p) => (p.visible = studio.terrace > 0.05));

    // materials: existing finished, studio white → timber and zinc once built
    lowerMat.color.copy(colors.model).lerp(finish.lower, 0.9);
    slabMat.color.copy(colors.model).lerp(finish.slab, 0.75);
    frameMat.color.copy(finish.frame);
    doorMat.color.copy(finish.door);
    upperMat.color.copy(colors.model).lerp(finish.upper, timber);
    roofMat.color.copy(colors.model).lerp(finish.roof, timber);
    frameNewMat.color.copy(colors.model).lerp(colors.ink, 0.55).lerp(finish.frame, built);
    inkFaint.opacity = mix(0.26, 0.4, built);

    // windows: the studio glazing goes in with the design; every window warms at dusk
    const g = studio.glazing;
    frameNewMat.opacity = g;
    glassNewMat.color.copy(glassDay).lerp(glassLit, pose.dusk);
    glassMat.color.copy(glassDay).lerp(glassLit, pose.dusk);
    glassNewMat.opacity = g * mix(0.55, 0.92, Math.max(built * 0.4, pose.dusk));
    glassMat.opacity = mix(0.6, 0.92, Math.max(0.3, pose.dusk)) * solid;
    // on site, the studio glazing goes in once the walls are up
    const glazed = onSite ? walls > 0.98 && roofUp > 0.5 : walls > 0.95;
    glazing.forEach((item) => (item.visible = glazed && g > 0.001));

    // the section: the cut slides in from the street to the middle of the studio
    cut.constant = mix(CUT_FAR, CUT_AT, smooth(pose.section.cut));
  }

  return {
    update,
    clippingPlanes,
    studioBounds: new THREE.Box3(new THREE.Vector3(B.x0, H * 2, B.z0), new THREE.Vector3(B.x1, H * 3 + ridge, B.z1)),
    dims: { A, B, H, T, ridge, eave },
    pens: { ink, inkOld },
    dispose() {
      owned.forEach((o) => o.dispose());
      scene.remove(root);
    },
  };
}
