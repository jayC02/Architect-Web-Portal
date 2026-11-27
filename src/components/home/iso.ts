// Isometric line drawings for the homepage: boxes, gable roofs and lines in 3D,
// projected flat so they read as small models drawn in pen. x runs to the right
// and down, y to the left and down, z straight up. Faces are drawn back to front
// with paper fills, so nearer shapes hide what is behind them.

export type P3 = [number, number, number];

const COS = Math.cos(Math.PI / 6);

/** Screen position of a point in model space. */
export const pt = ([x, y, z]: P3): [number, number] => [(x - y) * COS, (x + y) * 0.5 - z];

const fmt = (n: number) => Number(n.toFixed(2));
const pathOf = (points: P3[], close = true) =>
  'M' + points.map((p) => pt(p).map(fmt).join(' ')).join('L') + (close ? 'Z' : '');

const face = (points: P3[], cls: string) => `<path class="${cls}" d="${pathOf(points)}"/>`;

/** A solid box: its top and the two faces turned towards the viewer. */
export function box([x, y, z]: P3, [w, d, h]: P3, cls = '') {
  const X = x + w, Y = y + d, Z = z + h;
  return [
    face([[x, Y, z], [X, Y, z], [X, Y, Z], [x, Y, Z]], `f-left ${cls}`),
    face([[X, y, z], [X, Y, z], [X, Y, Z], [X, y, Z]], `f-right ${cls}`),
    face([[x, y, Z], [X, y, Z], [X, Y, Z], [x, Y, Z]], `f-top ${cls}`),
  ].join('');
}

/** A gable roof whose ridge runs along x, sitting on a box of the same footprint. */
export function gable([x, y, z]: P3, [w, d]: [number, number], rise: number, cls = '') {
  const X = x + w, Y = y + d, mid = y + d / 2, R = z + rise;
  return [
    face([[x, y, z], [X, y, z], [X, mid, R], [x, mid, R]], `f-top ${cls}`),
    face([[X, y, z], [X, Y, z], [X, mid, R]], `f-right ${cls}`),
    face([[x, Y, z], [X, Y, z], [X, mid, R], [x, mid, R]], `f-left ${cls}`),
  ].join('');
}

/** An open line through model points. */
export const line = (points: P3[], cls = 'ln') => `<path class="${cls}" d="${pathOf(points, false)}"/>`;

/** A flat rectangle lying on the ground, for site boundaries and sheets of paper. */
export const flat = ([x, y, z]: P3, [w, d]: [number, number], cls = '') =>
  face([[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z]], cls);

/** Screen offset for moving along a model direction, for CSS transforms. */
export const shift = (v: P3) => {
  const [sx, sy] = pt(v);
  return `${fmt(sx)}px, ${fmt(sy)}px`;
};

/** A viewBox that fits every point drawn in some SVG markup, with padding. */
export function viewBoxOf(markup: string, pad = 8) {
  const nums = [...markup.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)];
  const xs = nums.map((m) => Number(m[1])), ys = nums.map((m) => Number(m[2]));
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  return `${fmt(x0)} ${fmt(y0)} ${fmt(Math.max(...xs) + pad - x0)} ${fmt(Math.max(...ys) + pad - y0)}`;
}

/** A small two-storey house with windows and a door, the drawing used across the homepage. */
export function house(origin: P3 = [0, 0, 0], cls = '') {
  const [x, y, z] = origin;
  const parts = [
    box([x, y, z], [60, 40, 44], cls),
    gable([x, y, z + 44], [60, 40], 18, cls),
  ];
  // windows on the right face (x = x + 60) and the left face (y = y + 40)
  for (const [a, b] of [[8, 8], [24, 8], [8, 28], [24, 28]]) {
    parts.push(`<path class="win ${cls}" d="${pathOf([[x + 60, y + a, z + b], [x + 60, y + a + 9, z + b], [x + 60, y + a + 9, z + b + 10], [x + 60, y + a, z + b + 10]])}"/>`);
  }
  for (const [a, b] of [[10, 28], [42, 28], [42, 8]]) {
    parts.push(`<path class="win ${cls}" d="${pathOf([[x + a, y + 40, z + b], [x + a + 10, y + 40, z + b], [x + a + 10, y + 40, z + b + 10], [x + a, y + 40, z + b + 10]])}"/>`);
  }
  parts.push(`<path class="door ${cls}" d="${pathOf([[x + 18, y + 40, z], [x + 30, y + 40, z], [x + 30, y + 40, z + 20], [x + 18, y + 40, z + 20]])}"/>`);
  return parts.join('');
}

/** A tower crane: mast, jib and counter-jib. The trolley, cable and load are drawn by the caller. */
export function crane(base: P3, height: number, jib: number) {
  const [x, y, z] = base;
  const top = z + height;
  const parts = [box([x - 3, y - 3, z], [6, 6, 3], 'mast-foot')];
  // the mast as a lattice: four legs and cross bracing
  const legs = [[x - 2, y - 2], [x + 2, y - 2], [x + 2, y + 2], [x - 2, y + 2]];
  for (const [lx, ly] of legs) parts.push(line([[lx, ly, z + 3], [lx, ly, top]], 'ln mast'));
  for (let h = z + 3; h < top - 1; h += 8) {
    parts.push(line([[x + 2, y - 2, h], [x + 2, y + 2, h + 8]], 'ln brace'));
    parts.push(line([[x - 2, y + 2, h], [x + 2, y + 2, h + 8]], 'ln brace'));
  }
  // jib out along +x, counter-jib back along -x, with the counterweight
  parts.push(line([[x - 2, y, top], [x + jib, y, top]], 'ln jib'));
  parts.push(line([[x - 2, y, top + 3], [x + jib * 0.7, y, top]], 'ln tie'));
  parts.push(line([[x, y, top], [x, y, top + 12]], 'ln mast'));
  parts.push(line([[x, y, top + 12], [x + jib * 0.55, y, top]], 'ln tie'));
  parts.push(line([[x, y, top + 12], [x - 20, y, top]], 'ln tie'));
  parts.push(line([[x - 2, y, top], [x - 22, y, top]], 'ln jib'));
  parts.push(box([x - 22, y - 2, top - 6], [7, 4, 6], 'weight'));
  parts.push(box([x + 2, y - 3, top - 7], [6, 6, 6], 'cab'));
  return parts.join('');
}
