// Documents fly from the model into the Architect Pro window. The window lives in HTML,
// so each frame its on-screen rectangle is turned into a point in the 3D scene.

/** Used when the window is hidden or has no size: up and to the right, where it usually sits. */
export const ANCHOR_FALLBACK = Object.freeze({ x: 0.55, y: 0.35 });

/** The window's centre in normalised device coordinates (-1…1, y up). */
export function anchorFromRect(rect, viewport) {
  if (!rect || !viewport) return ANCHOR_FALLBACK;
  const { left, top, width, height } = rect;
  if (!(width > 0 && height > 0 && viewport.width > 0 && viewport.height > 0)) return ANCHOR_FALLBACK;
  const x = ((left + width / 2) / viewport.width) * 2 - 1;
  const y = 1 - ((top + height / 2) / viewport.height) * 2;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : ANCHOR_FALLBACK;
}

/** The point `distance` in front of the camera that appears at `ndc` on screen. */
export function worldAtNdc(camera, ndc, distance, out) {
  out.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
  return out.multiplyScalar(distance).add(camera.position);
}
