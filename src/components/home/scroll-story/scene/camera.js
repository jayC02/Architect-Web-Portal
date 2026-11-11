import * as THREE from "three";
import { clamp, win } from "../story.js";

// One continuous camera rail. Columns:
// progress, position xyz, target xyz, vertical FOV, roll (degrees)
const rail = [
  // site: top-down plan
  [0.0, 2, 40, 7, 0, 0, 0.5, 38, -14],
  [0.06, 5, 33, 13, 0, 0, 0.5, 38, -6],
  [0.13, 13, 20, 19, 0, 1, 0, 38, 0],
  // design: low hero angles as the walls rise
  [0.19, 17, 5, 12, 0, 3.4, 0, 36, 4],
  [0.25, 7, 4.6, 23, 0, 4.4, 0, 36, 0],
  // the portal: tilted orbit through the storm, face to face with the portal, then up to see the 30-minute ring
  [0.31, -16, 9, 13, 0, 4.8, 0, 36, -3],
  [0.35, -9, 6.5, 11, 0, 6.5, 0, 52, -12],
  [0.395, 5, 12.8, 18.5, 0, 13.4, 2.8, 42, -5],
  [0.435, 6, 30, 22, 0, 2, 0, 44, 4],
  // automation: the ring collapses, the scan runs, documents sort into two boards
  [0.48, -4, 27, 26, 0, 4, 0, 44, 0],
  [0.525, 0, 11, 29, 0, 10, -2, 44, 0],
  [0.565, 15, 6.5, 16, 0, 5, 0, 38, -5],
  [0.6, -6, 13, 21, 0, 15.5, -10, 46, 3],
  // tracking: two stacks, beams up, the project record fills in
  [0.645, 0, 13.5, 14, 0, 13.6, -4, 46, 0],
  [0.69, 9, 19, 13, 0, 14, -4, 44, -4],
  [0.735, -6, 14, 11.5, 0, 14.6, -5, 44, 3],
  [0.775, 0, 13, 17, 0, 11, -2, 42, 0],
  // time back: the house finishes at golden hour, the ring returns, dusk aerial
  [0.815, -12, 8, 18, 0, 5, 0, 40, 2],
  [0.86, 14, 9, 22, 0, 3.5, 0, 38, 0],
  [0.91, 22, 20, 24, 0, 2.5, 0, 40, -2],
  [0.965, -18, 22, 30, 0, 2, 0, 38, 0],
  [1.0, -26, 34, 36, 0, 1.5, 0, 36, 0],
];

/** Cubic Hermite with time-aware tangents, so cuts between shots never kink. */
function railValue(p, col) {
  p = clamp(p);
  let i = 0;
  while (i < rail.length - 2 && p > rail[i + 1][0]) i++;
  const a = rail[i],
    b = rail[i + 1],
    before = rail[Math.max(0, i - 1)],
    after = rail[Math.min(rail.length - 1, i + 2)],
    span = b[0] - a[0],
    t = (p - a[0]) / span;
  const m0 = (b[col] - before[col]) / (b[0] - before[0]),
    m1 = (after[col] - a[col]) / (after[0] - a[0]);
  const t2 = t * t,
    t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * a[col] + (t3 - 2 * t2 + t) * span * m0 + (-2 * t3 + 3 * t2) * b[col] + (t3 - t2) * span * m1;
}

export function createCameraRig(camera) {
  const target = new THREE.Vector3(),
    offset = new THREE.Vector3(),
    pointer = new THREE.Vector2(),
    eased = new THREE.Vector2();
  return {
    pointer,
    target,
    update(p, width, height, dt) {
      const aspect = width / height;
      const portrait = aspect < 1;
      let shiftX = 0,
        shiftY = 0;
      if (portrait) {
        // Phones: the copy fills the lower part of the screen, so frame the model in the
        // space above it. Acts with a status panel at the top keep it a little lower.
        const panel = win(p, 0.3, 0.33) * (1 - win(p, 0.765, 0.79));
        shiftY = 0.17 - 0.07 * panel;
      } else {
        // On wide screens, acts without a side panel set the model to the right of the copy.
        const wide = Math.max(0, aspect - 1.25);
        // the closing headline needs a little more room still
        shiftX = (1 - win(p, 0.29, 0.33) + win(p, 0.775, 0.81)) * Math.min(0.13, wide * 0.4) + win(p, 0.945, 0.975) * Math.min(0.09, wide * 0.3);
      }
      if (shiftX > 0.001 || shiftY > 0.001) camera.setViewOffset(width, height, -width * shiftX, height * shiftY, width, height);
      else if (camera.view) camera.clearViewOffset();
      // a little parallax from the pointer, eased so it never jitters
      eased.lerp(pointer, 1 - Math.exp(-dt * 3));
      target.set(railValue(p, 4), railValue(p, 5), railValue(p, 6));
      offset.set(railValue(p, 1), railValue(p, 2), railValue(p, 3)).sub(target);
      // Narrow screens: pull back so the subject fits the width. Phones split the job between
      // stepping back and a slightly wider lens, so the camera stays close to its planned path.
      const fit = portrait ? Math.min(1.9, 0.72 / aspect + 0.3) : aspect < 1.3 ? 1.12 : 1;
      offset.multiplyScalar(fit);
      offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, eased.x * 0.06);
      camera.position.copy(target).add(offset);
      camera.position.y += eased.y * 0.6;
      camera.fov = railValue(p, 7) * (portrait ? 1.16 : 1);
      camera.updateProjectionMatrix();
      camera.lookAt(target);
      // tilted horizons feel like the phone is moving in your hand, so keep them gentle there
      camera.rotateZ(THREE.MathUtils.degToRad(railValue(p, 8) * (portrait ? 0.35 : 1)));
    },
  };
}
