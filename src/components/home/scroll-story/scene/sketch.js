import * as THREE from "three";
import { clamp, mix, smooth } from "../story.js";
import { ribbon, ribbonMaterial } from "./lines.js";
import { inkMaterial, inkEdges } from "./ink.js";

// The end of the story: on a sheet of paper beside the finished house, a pencil starts
// drawing the next one. The time saved goes back into design.

const SHEET = { x: 12.3, z: 0.4, w: 4.2, d: 6 };
const Y = 0.03;

/** A small house elevation, in drawing order, in sheet units (u across, v up, 0…1). */
function elevation() {
  const s = [];
  const L = (a, b, c, d) => s.push([a, b, c, d]);
  L(0.08, 0.12, 0.92, 0.12); // ground line
  L(0.18, 0.12, 0.18, 0.55); // walls
  L(0.82, 0.12, 0.82, 0.55);
  L(0.12, 0.55, 0.5, 0.85); // roof
  L(0.5, 0.85, 0.88, 0.55);
  L(0.12, 0.55, 0.88, 0.55); // eaves
  L(0.44, 0.12, 0.44, 0.34); // door
  L(0.44, 0.34, 0.56, 0.34);
  L(0.56, 0.34, 0.56, 0.12);
  for (const [a, b] of [[0.24, 0.36], [0.64, 0.76]]) {
    L(a, 0.38, b, 0.38); // windows
    L(b, 0.38, b, 0.48);
    L(b, 0.48, a, 0.48);
    L(a, 0.48, a, 0.38);
  }
  L(0.56, 0.7, 0.56, 0.86); // chimney
  L(0.56, 0.86, 0.64, 0.86);
  L(0.64, 0.86, 0.64, 0.66);
  return s;
}

export function createSketch(scene, { mobile }) {
  const owned = [];
  const own = (o) => (owned.push(o), o);
  const root = new THREE.Group();
  scene.add(root);

  // the sheet of paper, lying on the ground
  const paperMat = own(new THREE.MeshLambertMaterial({ color: "#fffdf8", transparent: true, opacity: 0 }));
  const paperGeo = own(new THREE.PlaneGeometry(SHEET.w, SHEET.d));
  const paper = new THREE.Mesh(paperGeo, paperMat);
  paper.rotation.x = -Math.PI / 2;
  paper.position.set(SHEET.x, Y - 0.01, SHEET.z);
  paper.receiveShadow = !mobile;
  const border = own(inkMaterial(1.2, 0));
  const edge = inkEdges(paperGeo, border, 1);
  owned.push(edge.geometry);
  paper.add(edge);
  root.add(paper);

  // the drawing, in world coordinates on the sheet: u across, v towards the far edge
  const toWorld = ([u0, v0, u1, v1]) => {
    const x0 = SHEET.x - SHEET.w * 0.42 + u0 * SHEET.w * 0.84,
      x1 = SHEET.x - SHEET.w * 0.42 + u1 * SHEET.w * 0.84;
    const z0 = SHEET.z + SHEET.d * 0.36 - v0 * SHEET.d * 0.72,
      z1 = SHEET.z + SHEET.d * 0.36 - v1 * SHEET.d * 0.72;
    return [x0, z0, x1, z1];
  };
  const segs = elevation().map(toWorld);
  const lineMat = own(ribbonMaterial("#4a4f5c", 1));
  const drawing = new THREE.Mesh(own(ribbon(segs, 0.07, Y + 0.005)), lineMat);
  drawing.renderOrder = 3;
  root.add(drawing);
  // cumulative lengths, so the pencil can sit exactly at the drawing tip
  const lengths = segs.map(([a, b, c, d]) => Math.hypot(c - a, d - b));
  const total = lengths.reduce((s, l) => s + l, 0);

  // the pencil: a yellow hexagonal body, a sharpened wooden cone and a graphite point
  const pencil = new THREE.Group();
  const bodyGeo = own(new THREE.CylinderGeometry(0.11, 0.11, 2.2, 6).translate(0, 1.45, 0));
  const coneGeo = own(new THREE.ConeGeometry(0.11, 0.34, 6).rotateX(Math.PI).translate(0, 0.17, 0));
  const pen = own(inkMaterial(1.2, 1));
  const body = new THREE.Mesh(bodyGeo, own(new THREE.MeshLambertMaterial({ color: "#f2c14e" })));
  const cone = new THREE.Mesh(coneGeo, own(new THREE.MeshLambertMaterial({ color: "#e9cfa6" })));
  [body, cone].forEach((m) => {
    m.castShadow = !mobile;
    const e = inkEdges(m.geometry, pen, 20);
    owned.push(e.geometry);
    m.add(e);
  });
  pencil.add(body, cone);
  root.add(pencil);

  const tipAt = (t, out) => {
    let run = t * total;
    for (let i = 0; i < segs.length; i++) {
      if (run <= lengths[i] || i === segs.length - 1) {
        const k = lengths[i] ? clamp(run / lengths[i]) : 0;
        const [a, b, c, d] = segs[i];
        return out.set(mix(a, c, k), Y, mix(b, d, k));
      }
      run -= lengths[i];
    }
    return out;
  };
  const tip = new THREE.Vector3();
  const restAt = new THREE.Vector3(SHEET.x + SHEET.w * 0.55, 0.12, SHEET.z - 0.4);

  function update(pose, colors, time) {
    const s = pose.sketch;
    root.visible = s > 0.001;
    if (!root.visible) return;
    const appear = smooth(clamp(s * 6));
    paperMat.opacity = appear;
    border.opacity = 0.5 * appear;
    border.color.copy(colors.ink);
    pen.color.copy(colors.ink);
    // the line draws itself after the paper is down; the pencil rides its tip
    const draw = clamp((s - 0.12) / 0.82);
    lineMat.uniforms.uReveal.value = draw;
    lineMat.uniforms.uOpacity.value = appear;
    tipAt(draw, tip);
    // a writing hand: tilted, with a slight wobble, then laid down beside the drawing
    const rest = smooth(clamp((s - 0.94) / 0.06));
    pencil.position.copy(tip).lerp(restAt, rest);
    pencil.rotation.set(mix(-0.5 + Math.sin(time * 9) * 0.03 * (1 - rest), Math.PI / 2, rest), mix(0.6, 0.2, rest), mix(0.35, 0, rest));
    pencil.scale.setScalar(appear);
  }

  return {
    update,
    dispose() {
      owned.forEach((o) => o.dispose());
      scene.remove(root);
    },
  };
}
