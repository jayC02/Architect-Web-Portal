// The small 3D drawings on the homepage, built from the isometric helpers.
// Each returns SVG markup and the viewBox that fits it. Moving parts are wrapped
// in groups with classes the homepage stylesheet animates.
import { box, crane, flat, house, line, pt, shift, viewBoxOf, type P3 } from './iso';

export interface Scene { svg: string; viewBox: string }

const scene = (svg: string, pad = 10): Scene => ({ svg, viewBox: viewBoxOf(svg, pad) });

/** An upright sheet of paper standing in the plane y = Y, facing the viewer. */
const sheet = (x: number, Y: number, z: number, w: number, h: number, cls = 'sheet') =>
  `<path class="${cls}" d="M${[[x, Y, z], [x + w, Y, z], [x + w, Y, z + h], [x, Y, z + h]].map((p) => pt(p as P3).map((n) => n.toFixed(2)).join(' ')).join('L')}Z"/>`;

const sheetLines = (x: number, Y: number, z: number, w: number, rows: number[], cls = 'ln text') =>
  rows.map((r, i) => line([[x + 6, Y, z + r], [x + w - (i % 3 === 2 ? 22 : 8), Y, z + r]], cls)).join('');

const circleAt = (p: P3, r: number, inner = '', cls = 'tick') => {
  const [cx, cy] = pt(p);
  return `<g class="${cls}" style="transform-origin:${cx.toFixed(1)}px ${cy.toFixed(1)}px"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}"/>${inner || `<path d="M${(cx - r * 0.45).toFixed(1)} ${cy.toFixed(1)}l${(r * 0.3).toFixed(1)} ${(r * 0.32).toFixed(1)} ${(r * 0.55).toFixed(1)} ${(-r * 0.62).toFixed(1)}"/>`}</g>`;
};

/** Drawings dropping into an upload tray. */
export function tray(): Scene {
  const parts = [box([0, 0, 0], [84, 60, 6], 'tray')];
  for (let i = 0; i < 6; i++) {
    const x = 9 + (i % 2) * 3, y = 7 + i * 1.2, z = 6.4 + i * 1.6;
    parts.push(`<g class="drop" style="--i:${i}">${flat([x, y, z], [62, 44], 'paper')}${flat([x + 50, y + 4, z], [8, 5], 'pdf')}${line([[x + 8, y + 14, z], [x + 40, y + 14, z]], 'ln text')}${line([[x + 8, y + 22, z], [x + 46, y + 22, z]], 'ln text')}${line([[x + 8, y + 30, z], [x + 30, y + 30, z]], 'ln text')}</g>`);
  }
  return scene(parts.join(''), 14);
}

/** One sheet being read: a scan line passes down it and the fields it finds light up. */
export function reader(): Scene {
  const Y = 30, w = 60, h = 80;
  const parts = [flat([-6, Y - 8, 0], [72, 12], 'ground'), sheet(0, Y, 0, w, h)];
  parts.push(sheetLines(0, Y, 0, w, [70, 63, 56, 44, 37, 25, 18, 11]));
  [[66, 0], [40, 1], [14, 2]].forEach(([z, i]) => parts.push(`<g class="field" style="--i:${i}">${sheet(4, Y, z - 1, w - 8, 9, 'hit')}</g>`));
  parts.push(`<g class="scan">${line([[-4, Y, h - 2], [w + 4, Y, h - 2]], 'ln beam')}</g>`);
  return scene(parts.join(''), 12);
}

/** Three forms standing in a row, ticked off one after another. */
export function forms(): Scene {
  const parts: string[] = [];
  [0, 1, 2].forEach((i) => {
    const x = i * 30, Y = 20 - i * 14;
    parts.push(`<g class="form" style="--i:${i}">${sheet(x, Y, 0, 44, 60)}${sheet(x, Y, 50, 44, 10, 'band')}${sheetLines(x, Y, 0, 44, [40, 33, 26, 19, 12])}${circleAt([x + 40, Y, 58], 9)}</g>`);
  });
  return scene(parts.join(''), 14);
}

/** Planning: the house as a pen sketch on its site, red line round the boundary. */
export function planning(): Scene {
  return scene(`${flat([-16, -14, 0], [92, 70], 'boundary')}<g class="sketched">${house([0, 0, 0], 'open')}</g>`);
}

/** Building warrant: the house as a model, a section plane cut through it. */
export function warrant(): Scene {
  const cut = [[30, -12, -4], [30, 52, -4], [30, 52, 72], [30, -12, 72]] as P3[];
  const plane = `<path class="cut" d="M${cut.map((p) => pt(p).map((n) => n.toFixed(2)).join(' ')).join('L')}Z"/>`;
  return scene(`${flat([-10, -8, 0], [80, 58], 'ground')}${house([0, 0, 0])}<g class="section">${plane}</g>`);
}

/** Construction: the ground storey up, scaffold round the first floor, a crane lifting the next piece. */
export function construction(): Scene {
  const parts = [flat([-44, -18, 0], [126, 76], 'ground'), crane([-30, 12, 0], 104, 92)];
  parts.push(box([0, 0, 0], [60, 40, 22]), box([-1, -1, 22], [62, 42, 2], 'slab'));
  // scaffold: poles at the corners of the upper storey and two rails
  for (const [x, y] of [[-4, -4], [64, -4], [64, 44], [-4, 44]]) parts.push(line([[x, y, 0], [x, y, 46]], 'ln scaffold'));
  for (const z of [30, 44]) parts.push(line([[-4, 44, z], [64, 44, z], [64, -4, z]], 'ln scaffold'));
  // trolley, cable and load hang from the jib; the stylesheet moves them
  const top = 104;
  const trolley = box([24, 10, top - 3], [6, 4, 3], 'cab');
  const cable = line([[27, 12, top - 3], [27, 12, 62]], 'ln cable');
  const load = box([18, 4, 54], [18, 16, 8], 'load');
  parts.push(`<g class="trolley" style="--run:${shift([22, 0, 0])}">${trolley}<g class="hook">${cable}<g class="load-box">${load}</g></g></g>`);
  return scene(parts.join(''), 10);
}

/** Completion: the finished house, a path to the door and a hedge. */
export function completion(): Scene {
  const parts = [flat([-12, -10, 0], [84, 74], 'ground'), flat([18, 40, 0], [12, 24], 'pathway')];
  parts.push(box([-8, 52, 0], [20, 8, 8], 'hedge'), box([40, 52, 0], [24, 8, 8], 'hedge'));
  parts.push(house([0, 0, 0], 'built'));
  parts.push(circleAt([66, 0, 90], 11, '', 'tick done-badge'));
  return scene(parts.join(''), 12);
}

/** The hero's site: a house, and a crane bringing a finished form down onto it. */
export function heroSite(): Scene {
  const parts = [flat([-60, -30, 0], [150, 100], 'ground'), crane([-40, 10, 0], 120, 110)];
  parts.push(house([0, 0, 0], 'built'));
  const top = 120;
  const trolley = box([34, 8, top - 3], [6, 4, 3], 'cab');
  const cable = line([[37, 10, top - 3], [37, 10, 86]], 'ln cable');
  const load = `${sheet(26, 10, 66, 22, 20, 'paper')}${sheet(26, 10, 82, 22, 4, 'band')}`;
  parts.push(`<g class="trolley" style="--run:${shift([26, 0, 0])}">${trolley}<g class="hook">${cable}<g class="load-box">${load}</g></g></g>`);
  return scene(parts.join(''), 10);
}
