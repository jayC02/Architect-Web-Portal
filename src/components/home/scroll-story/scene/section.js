import * as THREE from "three";
import { APPLICATIONS, clamp, mix, smooth } from "../story.js";
import { inkMaterial, inkEdges } from "./ink.js";

// Building warrant: the studio is cut open in section. Where the cut passes through solid
// construction it is hatched, as on a drawing, and the wall build-up steps out of the cut
// face as five layers that fly, one by one, into the U-value calculator.

const LAYERS = [
  { color: "#c9785e", depth: 0.34 }, // brick
  { color: "#ffffff", depth: 0.18, void: true }, // cavity
  { color: "#efd15a", depth: 0.34 }, // PIR insulation
  { color: "#b9c0c8", depth: 0.34 }, // block
  { color: "#f1efe9", depth: 0.1 }, // plasterboard
];

export function createSection(scene, building, { mobile }) {
  const owned = [];
  const own = (o) => (owned.push(o), o);
  const root = new THREE.Group();
  scene.add(root);
  const { B, H, T } = building.dims;
  const CUT_Z = 0.35;
  const warrant = APPLICATIONS[1].colour;
  const unitBox = own(new THREE.BoxGeometry(1, 1, 1));
  const pen = own(inkMaterial(1.6, 1));

  // --- Caps on the cut face, filled like poché on a section drawing: the two studio walls and the ceiling plate
  const capMat = own(new THREE.MeshBasicMaterial({ color: warrant, transparent: true, opacity: 0, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const capGeo = own(new THREE.PlaneGeometry(1, 1));
  const caps = [
    [B.x0 + T / 2, H * 2 + H / 2, T, H],
    [B.x1 - T / 2, H * 2 + H / 2, T, H],
    [(B.x0 + B.x1) / 2, H * 3 + 0.1, B.x1 - B.x0, 0.2],
  ].map(([x, y, w, h]) => {
    const m = new THREE.Mesh(capGeo, capMat);
    m.position.set(x, y, CUT_Z + 0.002);
    m.scale.set(w, h, 1);
    m.renderOrder = 3;
    const edge = inkEdges(capGeo, pen, 1);
    owned.push(edge.geometry);
    m.add(edge);
    root.add(m);
    return m;
  });

  // --- The cutting plane itself, seen only while it slices through
  const bladeMat = own(new THREE.MeshBasicMaterial({ color: warrant, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  const blade = new THREE.Mesh(capGeo, bladeMat);
  blade.scale.set(B.x1 - B.x0 + 1.6, H + 2.6, 1);
  blade.position.set((B.x0 + B.x1) / 2, H * 2 + H / 2 + 0.7, 0);
  // its own pen: it fades on its own, while the caps and layers stay inked
  const bladePen = own(inkMaterial(1.6, 0));
  const bladeEdge = inkEdges(capGeo, bladePen, 1);
  owned.push(bladeEdge.geometry);
  blade.add(bladeEdge);
  blade.renderOrder = 4;
  root.add(blade);

  // --- The wall build-up, drawn thicker than life so each layer reads
  const wallX = B.x1 - T / 2,
    wallY = H * 2 + H / 2;
  const layers = LAYERS.map((spec) => {
    const mat = own(
      spec.void
        ? new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.25, depthWrite: false })
        : new THREE.MeshLambertMaterial({ color: spec.color, transparent: true }),
    );
    const mesh = new THREE.Mesh(unitBox, mat);
    mesh.castShadow = !mobile && !spec.void;
    mesh.scale.set(spec.depth, 2.9, 2.2);
    const edges = inkEdges(unitBox, pen);
    owned.push(edges.geometry);
    mesh.add(edges);
    mesh.visible = false;
    root.add(mesh);
    return { mesh, mat, spec };
  });

  const from = new THREE.Vector3(),
    fanned = new THREE.Vector3(),
    ctrl = new THREE.Vector3(),
    pos = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    qFan = new THREE.Quaternion(),
    up = new THREE.Vector3(0, 1, 0);

  function update(pose, colors, time, anchor, camera) {
    const { cut, explode, uvalue } = pose.section;
    const capOn = clamp((cut - 0.9) * 10);
    capMat.opacity = 0.9 * capOn;
    caps.forEach((c) => (c.visible = capOn > 0.01));
    // the blade follows the cut in from the street, then fades once it has passed through
    const slicing = Math.sin(clamp(pose.section.cut) * Math.PI);
    blade.position.z = building.clippingPlanes[0].constant;
    bladeMat.opacity = 0.18 * slicing;
    blade.visible = slicing > 0.01;
    bladePen.opacity = slicing;
    bladePen.color.copy(colors.ink);
    pen.color.copy(colors.ink);

    // each layer flies when the calculator lists it
    let any = false;
    const offset = LAYERS.reduce((s, l) => s + l.depth, 0) / 2;
    let x = -offset;
    layers.forEach(({ mesh, mat, spec }, i) => {
      const centre = x + spec.depth / 2;
      x += spec.depth;
      const fly = smooth(clamp(uvalue * LAYERS.length - i));
      const out = smooth(explode);
      const on = out > 0.001 && fly < 1;
      mesh.visible = on;
      if (!on) return;
      any = true;
      // inside the wall, at the cut face
      from.set(wallX + centre * 0.25, wallY, CUT_Z - 0.6);
      // stepped out of the wall towards the viewer and fanned apart
      fanned.set(wallX - 1.6 + i * 0.62, wallY + 0.2, CUT_Z + 1.6 + i * 0.12);
      pos.copy(from).lerp(fanned, out);
      // turned so each layer shows its face, like a fanned stack of panels
      qFan.setFromAxisAngle(up, mix(0, -1.15, out));
      q.copy(qFan);
      if (fly > 0) {
        ctrl.copy(pos).lerp(anchor.center, 0.5);
        ctrl.y += 3;
        const t = fly;
        pos.multiplyScalar((1 - t) ** 2).addScaledVector(ctrl, 2 * (1 - t) * t).addScaledVector(anchor.center, t * t);
        q.slerp(camera.quaternion, t);
      }
      mesh.position.copy(pos);
      mesh.quaternion.copy(q);
      const shrink = mix(1, (anchor.unit * 0.05) / 2.9, fly);
      mesh.scale.set(spec.depth * shrink, 2.9 * shrink, 2.2 * shrink);
      const fade = 1 - smooth(clamp((fly - 0.75) * 4));
      mat.opacity = (spec.void ? 0.25 : 1) * fade * clamp(out * 3);
      mesh.renderOrder = fly > 0.6 ? 30 : 0;
      mat.depthTest = fly < 0.6;
    });
    root.visible = any || capOn > 0.01 || blade.visible;
  }

  return {
    update,
    dispose() {
      owned.forEach((o) => o.dispose());
      scene.remove(root);
    },
  };
}
