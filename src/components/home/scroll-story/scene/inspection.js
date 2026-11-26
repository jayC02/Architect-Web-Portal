import * as THREE from "three";
import { APPLICATIONS, clamp, mix, smooth } from "../story.js";
import { ribbon, ribbonMaterial, arcSegments } from "./lines.js";
import { inkMaterial, inkLines } from "./ink.js";

// Completion: the finished house is checked over. A ring is drawn round it on the ground,
// and four checkpoints (fire, energy, drainage, electrical) each point at the part of the
// house they check, then turn into a green tick as a marker travels round the ring to them.

const R = 8.2;
const POINTS = [
  { angle: 0.55, target: [-2.2, 4.4, 3.3] }, // fire: the stair and escape route
  { angle: 2.0, target: [2, 7.6, 3.3] }, // energy: the studio wall
  { angle: 3.6, target: [5.6, 0.1, -1.5] }, // drainage: the ground by the side wall
  { angle: 5.1, target: [-5.1, 1.4, -1] }, // electrical: the consumer unit
];
const DISC_Y = 3.4;

export function createInspection(scene, textures, { mobile }) {
  const owned = [];
  const own = (o) => (owned.push(o), o);
  const root = new THREE.Group();
  scene.add(root);
  const green = APPLICATIONS[2].colour;

  // the ring on the ground, drawn from the first checkpoint round
  const ringGeo = own(ribbon(arcSegments(0, 0, R, POINTS[0].angle, POINTS[0].angle + Math.PI * 2, 96), 0.09, 0.05));
  const ringMat = own(ribbonMaterial(green, 1));
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.renderOrder = 2;
  root.add(ring);

  // the marker that travels round it
  const markerMat = own(new THREE.MeshBasicMaterial({ color: green, toneMapped: false }));
  const marker = new THREE.Mesh(own(new THREE.SphereGeometry(0.22, 16, 12)), markerMat);
  root.add(marker);

  const checkpoints = POINTS.map((pt, i) => {
    const pen = own(inkMaterial(1.3, 0.8));
    pen.dashed = true;
    pen.dashSize = 0.25;
    pen.gapSize = 0.18;
    const x = Math.cos(pt.angle) * R,
      z = Math.sin(pt.angle) * R;
    const iconMat = own(new THREE.SpriteMaterial({ map: textures.checkpoints[i], transparent: true, depthWrite: false, toneMapped: false }));
    const tickMat = own(new THREE.SpriteMaterial({ map: textures.tick, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
    const icon = new THREE.Sprite(iconMat),
      tick = new THREE.Sprite(tickMat);
    icon.position.set(x, DISC_Y, z);
    tick.position.set(x, DISC_Y, z);
    icon.renderOrder = tick.renderOrder = 8;
    // a post down to the ring, and a leader to what it checks
    const lines = inkLines([x, 0.05, z, x, DISC_Y - 0.5, z, x, DISC_Y, z, ...pt.target], pen);
    lines.computeLineDistances();
    owned.push(lines.geometry);
    root.add(icon, tick, lines);
    return { icon, tick, iconMat, tickMat, lines, pen };
  });

  function update(pose, colors) {
    const { ring: r, checks } = pose.inspection;
    root.visible = r > 0.001;
    if (!root.visible) return;
    ringMat.uniforms.uReveal.value = smooth(clamp(r * 1.2));
    ringMat.uniforms.uOpacity.value = r;
    // the marker sits at the checkpoint being checked, and travels on to the next
    const done = checks.reduce((s, c) => s + c, 0);
    const angle = markerAngle(done);
    marker.position.set(Math.cos(angle) * R, 0.25, Math.sin(angle) * R);
    marker.visible = r > 0.95;
    checkpoints.forEach((c, i) => {
      const show = clamp(r * 4 - i * 0.6);
      const ok = checks[i];
      const pop = 1 + Math.sin(clamp(ok) * Math.PI) * 0.35;
      c.iconMat.opacity = show * (1 - ok);
      c.tickMat.opacity = show * ok;
      c.icon.scale.setScalar(mix(0.2, 1.3, smooth(show)));
      c.tick.scale.setScalar(1.3 * pop);
      c.pen.color.copy(colors.ink);
      c.pen.opacity = 0.8 * show;
      c.lines.visible = show > 0.01;
    });
  }
  /** From checkpoint to checkpoint, around the ring in order. */
  function markerAngle(done) {
    const i = Math.min(POINTS.length - 1, Math.floor(done));
    const next = Math.min(POINTS.length - 1, i + 1);
    const t = done - i;
    return mix(POINTS[i].angle, POINTS[next].angle, smooth(t));
  }

  return {
    update,
    dispose() {
      owned.forEach((o) => o.dispose());
      scene.remove(root);
    },
  };
}
