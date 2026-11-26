import * as THREE from "three";
import { clamp, mix, win } from "../story.js";

// One continuous camera rail. Columns:
// progress, position xyz, target xyz, vertical FOV, roll (degrees)
const rail = [
  // opening: straight down on the paper, the house below and the minute ring around it
  [0.0, 2, 44, 8, 0, 0, 0.5, 38, -14],
  // planning: the red line drawn top-down, then the studio plan inked onto the roof
  [0.04, 4, 36, 13, 0, 1, 0.5, 38, -8],
  [0.075, 9, 25, 17, 1, 6, 0, 36, -3],
  // the studio rises: a low hero angle, then three-quarters on the street front
  [0.105, 15, 12, 17, 1.5, 7, 0, 36, 2],
  [0.13, -7, 10, 21, 1, 5.5, 0, 38, 0],
  // drawings peel off and fly to the window
  [0.17, -3, 12, 23, 1, 5.5, 0, 40, 0],
  [0.215, -9, 13, 21, 0.5, 5, 0, 40, 0],
  [0.25, -2, 10, 25, 0.5, 4.8, 0, 42, 0],
  // building warrant: square on to the section, then close on the wall build-up
  [0.29, 2, 9.5, 25, 2, 7, 0, 30, 0],
  [0.315, 3, 9, 21, 2.4, 7.3, 0.6, 30, 0],
  [0.355, 6, 9.2, 18, 3.2, 7.4, 1, 32, 0],
  // the warrant documents come together
  [0.395, -5, 12, 22, 1, 5.5, 0, 40, 0],
  [0.45, -9, 13, 20, 1, 5, 0, 40, 0],
  [0.49, -5, 20, 27, 0, 3, 0, 42, 0],
  // construction: a slow orbit that keeps the tower crane and the street crane in frame
  [0.53, -16, 17, 26, -1, 5, -1, 44, 0],
  [0.57, -26, 15, 12, -2, 6, -2, 46, -2],
  [0.61, -19, 16, 17, -1, 6, -1, 46, 0],
  [0.645, 2, 14, 26, 0, 5, 0, 42, 0],
  // completion: an eye-level walk round the finished house while it is checked
  [0.675, 14, 8, 20, 0, 4, 0, 44, 0],
  [0.695, 22, 8, 2, 0, 4, 0, 44, 0],
  [0.712, 13, 8.5, -19, 0, 4, 0, 44, 0],
  [0.728, -12, 8.5, -19, 0, 4, 0, 44, 0],
  [0.745, -22, 9, 4, 0, 4.5, 0, 44, 0],
  // then a calm three-quarter view while the certificates go in
  [0.79, -9, 11, 21, 0.5, 4.8, 0, 42, 0],
  [0.835, -4, 12, 23, 0.5, 4.6, 0, 42, 0],
  // time back: the house finishes at golden hour, the ring returns, dusk aerial
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
        const panel = win(p, 0.1, 0.12) * (1 - win(p, 0.88, 0.9));
        shiftY = 0.17 - 0.15 * panel;
      } else {
        // On wide screens, acts without a side panel set the model to the right of the copy.
        const wide = Math.max(0, aspect - 1.25);
        // the closing headline needs a little more room still
        // with the window on the right, the subject sits between the copy and the window
        const panel = win(p, 0.1, 0.12) * (1 - win(p, 0.88, 0.9));
        shiftX = mix(Math.min(0.13, wide * 0.4), Math.min(0.07, wide * 0.25), panel) + win(p, 0.945, 0.975) * Math.min(0.09, wide * 0.3);
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
