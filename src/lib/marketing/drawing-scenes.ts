// Linework for the drawing sheets that build up beside the marketing pages as a
// visitor scrolls. Each item belongs to a stage: stage 0 draws when the sheet
// first comes into view, and stages 1..N draw as the matching block of page
// content (marked data-sheet-stage="n") scrolls past. `s` and `e` place an item
// inside its stage, from 0 to 1, so lines within a stage follow one another.
//
// Every drawn path is a single subpath so it can be traced with pathLength="1".

export type Tone = 'ink' | 'thin' | 'faint' | 'accent' | 'sun';

export interface PathItem {
  kind: 'path';
  d: string;
  stage: number;
  s: number;
  e: number;
  tone: Tone;
  /** draw: traced along its length. fade: faded in (dashed and multi-part marks). */
  mode: 'draw' | 'fade';
  dashed?: boolean;
}

export interface TextItem {
  kind: 'text';
  text: string;
  x: number;
  y: number;
  stage: number;
  s: number;
  e: number;
  size: number;
  anchor: 'start' | 'middle' | 'end';
  tone: Tone;
  rotate?: number;
}

export type SheetItem = PathItem | TextItem;

export interface Scene {
  /** Title block caption. */
  caption: string;
  /** One revision per stage from 1, oldest first. */
  revisions: string[];
  items: SheetItem[];
  /** Optional room fills the pricing calculator can highlight, keyed by plan. */
  fills?: { room: string; d: string; stage: number }[];
}

export type SceneId = 'elevation' | 'plan' | 'section' | 'street';

const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}`;
const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let value = from; value <= to; value += step) out.push(value);
  return out;
};
const hatch = (from: number, to: number, y: number) => range(from, to, 16).map((x) => `M${x} ${y}l-8 9`).join('');

class Builder {
  items: SheetItem[] = [];

  draw(d: string, stage: number, s = 0, e = 1, tone: Tone = 'ink') {
    this.items.push({ kind: 'path', d, stage, s, e, tone, mode: 'draw' });
    return this;
  }

  fade(d: string, stage: number, s = 0, e = 1, tone: Tone = 'faint', dashed = false) {
    this.items.push({ kind: 'path', d, stage, s, e, tone, mode: 'fade', dashed });
    return this;
  }

  text(
    text: string,
    x: number,
    y: number,
    stage: number,
    s = 0.6,
    e = 1,
    options: { size?: number; anchor?: TextItem['anchor']; tone?: Tone; rotate?: number } = {},
  ) {
    this.items.push({
      kind: 'text', text, x, y, stage, s, e,
      size: options.size ?? 11,
      anchor: options.anchor ?? 'start',
      tone: options.tone ?? 'ink',
      rotate: options.rotate,
    });
    return this;
  }

  /** Draw several paths one after another inside [s0, e0], overlapping a little. */
  seq(paths: string[], stage: number, s0: number, e0: number, tone: Tone = 'ink', overlap = 0.45) {
    const count = paths.length;
    if (!count) return this;
    const length = (e0 - s0) / (1 + (count - 1) * (1 - overlap));
    const step = length * (1 - overlap);
    paths.forEach((d, index) => this.draw(d, stage, s0 + index * step, s0 + index * step + length, tone));
    return this;
  }
}

/** Front elevation of a two-storey house with a single-storey extension. */
function elevation(): Scene {
  const b = new Builder();

  // Stage 0: ground line, setting-out grid.
  b.draw('M40 440H560', 0, 0, 0.55);
  b.fade(hatch(48, 552, 440), 0, 0.35, 0.9);
  [120, 230, 340, 470].forEach((x, index) => {
    b.fade(`M${x} 72V470`, 0, 0.2 + index * 0.08, 0.7 + index * 0.08, 'faint', true);
    b.draw(circle(x, 60, 10), 0, 0.3 + index * 0.08, 0.75 + index * 0.06, 'thin');
    b.text('ABCD'[index], x, 64, 0, 0.6, 1, { anchor: 'middle' });
  });

  // Stage 1, project record: walls and first floor.
  b.draw('M120 440V250H340V440', 1, 0, 0.7);
  b.fade('M120 345H340', 1, 0.5, 0.9, 'faint', true);
  b.fade('M40 453H560', 1, 0.6, 1, 'accent', true);

  // Stage 2, drawings sorted: openings.
  const windows = [[140, 370, 50, 50], [270, 370, 50, 50], [140, 275, 50, 50], [270, 275, 50, 50], [215, 280, 30, 40]];
  b.seq([...windows.map(([x, y, w, h]) => rect(x, y, w, h)), 'M210 440V360H250V440'], 2, 0, 0.75);
  b.seq(windows.flatMap(([x, y, w, h]) => [`M${x + w / 2} ${y}V${y + h}`, `M${x} ${y + h / 2}H${x + w}`]), 2, 0.45, 1, 'thin', 0.6);

  // Stage 3, application prepared: roof, chimney, extension.
  b.draw('M105 258L230 140L355 258', 3, 0, 0.4, 'accent');
  b.draw('M280 187V150H302V208', 3, 0.3, 0.55);
  b.draw('M340 440V330H470V440', 3, 0.4, 0.75);
  b.draw('M335 330H475', 3, 0.6, 0.8);
  b.draw('M360 440V365H450V440', 3, 0.7, 0.95, 'thin');
  b.draw('M405 365V440', 3, 0.8, 1, 'thin');

  // Stage 4, portal completed: dimensions and levels.
  b.draw('M120 482H470', 4, 0, 0.4, 'thin');
  [120, 340, 470].forEach((x, index) => {
    b.fade(`M${x} 448V490`, 4, 0.1 + index * 0.1, 0.4 + index * 0.1);
    b.draw(`M${x - 5} 487L${x + 5} 477`, 4, 0.2 + index * 0.1, 0.5 + index * 0.1, 'thin');
  });
  b.text('6600', 230, 476, 4, 0.4, 0.7, { anchor: 'middle', size: 10 });
  b.text('3900', 405, 476, 4, 0.45, 0.75, { anchor: 'middle', size: 10 });
  ([[440, 'FFL +0.000', 120], [250, 'Eaves +5.700', 120], [140, 'Ridge +8.400', 225]] as const).forEach(([y, label, to], index) => {
    const s = 0.4 + index * 0.15;
    b.draw(`M100 ${y}L94 ${y - 9}H106Z`, 4, s, s + 0.2, 'thin');
    b.fade(`M100 ${y}H${to}`, 4, s + 0.1, s + 0.3, 'faint', true);
    b.text(label, 90, y - 4, 4, s + 0.15, s + 0.35, { anchor: 'end', size: 10 });
  });

  // Stage 5, decision tracked: notes and approval.
  b.draw(circle(180, 187, 2.5), 5, 0, 0.15, 'thin');
  b.draw('M180 187L150 104H70', 5, 0, 0.3, 'thin');
  b.text('Natural slate', 70, 98, 5, 0.2, 0.4);
  b.draw('M325 300L392 250H432', 5, 0.15, 0.4, 'thin');
  b.text('Render', 396, 244, 5, 0.3, 0.5);
  b.draw('M455 345L480 300H566', 5, 0.25, 0.5, 'thin');
  b.text('Timber cladding', 566, 294, 5, 0.4, 0.6, { anchor: 'end' });
  b.draw(circle(500, 170, 40), 5, 0.55, 0.85, 'accent');
  b.draw(circle(500, 170, 33), 5, 0.65, 0.9, 'thin');
  b.text('Approved', 500, 175, 5, 0.8, 1, { anchor: 'middle', size: 11, tone: 'accent', rotate: -14 });

  return {
    caption: 'Front elevation, 14 Harbour Lane',
    revisions: ['Project record set up', 'Drawings sorted', 'Application prepared', 'Portal completed', 'Decision tracked'],
    items: b.items,
  };
}

/** Office floor plan that grows a room for each plan, with desks for its users. */
function plan(): Scene {
  const b = new Builder();
  const desk = (x: number, y: number) => rect(x, y, 34, 18);

  // Stage 0: the first room, one desk.
  b.draw(rect(60, 300, 140, 140), 0, 0, 0.6);
  b.draw('M110 440V404', 0, 0.5, 0.65, 'thin');
  b.draw('M110 404A36 36 0 0 1 146 440', 0, 0.55, 0.8, 'thin');
  b.draw(desk(75, 316), 0, 0.6, 0.85, 'thin');
  b.text('Pay as you go', 130, 372, 0, 0.7, 1, { anchor: 'middle' });
  b.text('1 user', 130, 388, 0, 0.75, 1, { anchor: 'middle', size: 10, tone: 'faint' });

  // Stage 1: Practice, three desks.
  b.draw('M200 300H360V440H200', 1, 0, 0.5);
  b.seq([215, 255, 295].map((x) => desk(x, 316)), 1, 0.4, 0.85, 'thin');
  b.text('Practice', 280, 372, 1, 0.7, 1, { anchor: 'middle' });
  b.text('3 users', 280, 388, 1, 0.75, 1, { anchor: 'middle', size: 10, tone: 'faint' });

  // Stage 2: Studio, ten desks.
  b.draw('M60 300V160H360V300', 2, 0, 0.45);
  b.seq([176, 266].flatMap((y) => [80, 134, 188, 242, 296].map((x) => desk(x, y))), 2, 0.3, 0.9, 'thin', 0.6);
  b.text('Studio', 210, 226, 2, 0.7, 1, { anchor: 'middle' });
  b.text('10 users', 210, 242, 2, 0.75, 1, { anchor: 'middle', size: 10, tone: 'faint' });

  // Stage 3: Firm, a whole wing.
  b.draw('M360 160H540V440H360', 3, 0, 0.45);
  b.seq(range(178, 418, 30).flatMap((y) => [desk(376, y), desk(490, y)]), 3, 0.3, 0.9, 'thin', 0.7);
  b.draw(rect(420, 330, 60, 60), 3, 0.55, 0.8, 'thin');
  b.text('Firm', 450, 290, 3, 0.7, 1, { anchor: 'middle' });
  b.text('Unlimited', 450, 306, 3, 0.75, 1, { anchor: 'middle', size: 10, tone: 'faint' });

  // Stage 4: dimensions and north point.
  b.draw('M60 132H540', 4, 0, 0.4, 'thin');
  [60, 200, 360, 540].forEach((x, index) => {
    b.fade(`M${x} 126V156`, 4, 0.1 + index * 0.06, 0.4 + index * 0.06);
    b.draw(`M${x - 5} 137L${x + 5} 127`, 4, 0.2 + index * 0.06, 0.45 + index * 0.06, 'thin');
  });
  b.text('4200', 130, 126, 4, 0.4, 0.7, { anchor: 'middle', size: 10 });
  b.text('4800', 280, 126, 4, 0.45, 0.75, { anchor: 'middle', size: 10 });
  b.text('5400', 450, 126, 4, 0.5, 0.8, { anchor: 'middle', size: 10 });
  b.draw('M30 160V440', 4, 0.3, 0.6, 'thin');
  [160, 300, 440].forEach((y, index) => b.draw(`M25 ${y + 5}L35 ${y - 5}`, 4, 0.4 + index * 0.06, 0.6 + index * 0.06, 'thin'));
  b.text('4200', 22, 230, 4, 0.55, 0.8, { anchor: 'middle', size: 10, rotate: -90 });
  b.text('4200', 22, 370, 4, 0.6, 0.85, { anchor: 'middle', size: 10, rotate: -90 });
  b.draw(circle(560, 74, 16), 4, 0.6, 0.85, 'thin');
  b.draw('M560 96V52', 4, 0.7, 0.9, 'thin');
  b.draw('M560 52L554 66H566Z', 4, 0.75, 0.95, 'accent');
  b.text('N', 560, 44, 4, 0.8, 1, { anchor: 'middle', size: 11 });

  return {
    caption: 'Ground floor plan, your office',
    revisions: ['Practice: three desks', 'Studio: ten desks', 'Firm: a whole wing', 'Dimensions and north point'],
    items: b.items,
    fills: [
      { room: 'payg', d: rect(60, 300, 140, 140), stage: 0 },
      { room: 'practice', d: rect(200, 300, 160, 140), stage: 1 },
      { room: 'studio', d: rect(60, 160, 300, 140), stage: 2 },
      { room: 'firm', d: rect(360, 160, 180, 280), stage: 3 },
    ],
  };
}

/** Section through nested enclosures: each layer of protection drawn in turn. */
function section(): Scene {
  const b = new Builder();
  const profile = (inset: number) => {
    const left = 80 + inset;
    const right = 520 - inset;
    const eaves = 250 + inset * 0.45;
    const apex = 110 + inset * 1.1;
    return `M${left} 450V${eaves}L300 ${apex}L${right} ${eaves}V450`;
  };
  // Insulation zigzag up the wall cavity, as points from the ground upwards.
  const zig: string[] = [];
  for (let y = 434, index = 0; y >= 268; y -= 12, index += 1) zig.push(`${index % 2 ? 84 : 112} ${y}`);

  // Stage 0: ground and the outer wall.
  b.draw('M40 450H560', 0, 0, 0.5);
  b.fade(hatch(48, 552, 450), 0, 0.3, 0.8);
  b.draw(profile(0), 0, 0.3, 1, 'ink');

  // Stage 1: roles, the second layer and insulation between.
  b.draw(profile(36), 1, 0, 0.6);
  b.draw(`M84 446L${zig.join('L')}`, 1, 0.4, 0.9, 'thin');
  b.draw(`M516 446L${zig.map((point) => { const [x, y] = point.split(' ').map(Number); return `${600 - x} ${y}`; }).join('L')}`, 1, 0.5, 1, 'thin');

  // Stage 2: paid and approved access, the inner layer.
  b.draw(profile(72), 2, 0, 0.6);
  b.fade('M152 370H448', 2, 0.5, 0.9, 'faint', true);

  // Stage 3: private storage, a document under lock.
  b.draw('M270 330H316L330 344V408H270Z', 3, 0, 0.45);
  b.draw('M316 330V344H330', 3, 0.3, 0.5, 'thin');
  b.seq(['M280 358H320', 'M280 368H320', 'M280 378H306'], 3, 0.4, 0.7, 'thin');
  b.draw(rect(288, 300, 24, 18), 3, 0.55, 0.8, 'accent');
  b.draw('M292 300V293A8 8 0 0 1 308 293V300', 3, 0.65, 0.9, 'accent');

  // Stage 4: labels and the approval tick.
  b.draw('M190 180L150 70H40', 4, 0, 0.3, 'thin');
  b.text('Your practice', 40, 64, 4, 0.2, 0.45);
  b.draw('M380 200L420 90H560', 4, 0.15, 0.45, 'thin');
  b.text('Roles and permissions', 420, 84, 4, 0.35, 0.6);
  b.text('Private storage, signed links', 300, 482, 4, 0.45, 0.7, { anchor: 'middle', size: 10, tone: 'faint' });
  b.draw('M282 392L292 402L316 378', 4, 0.65, 0.95, 'accent');

  return {
    caption: 'Section A–A, layers of access',
    revisions: ['Roles and permissions', 'Paid and approved access', 'Private storage', 'Your approval'],
    items: b.items,
  };
}

/** Street elevation: tenement, cottage, studio and a crow-stepped gable. */
function street(): Scene {
  const b = new Builder();

  // Stage 0: the street and the tenement.
  b.draw('M30 440H570', 0, 0, 0.5);
  b.fade(hatch(38, 562, 440), 0, 0.3, 0.8);
  b.draw('M40 440V140H200V440', 0, 0.3, 0.9);
  b.draw('M34 150H206', 0, 0.7, 1, 'thin');

  // Stage 1: tenement windows and shopfront.
  b.seq([170, 230, 290].flatMap((y) => [62, 107, 152].map((x) => rect(x, y, 26, 38))), 1, 0, 0.75, 'thin', 0.6);
  b.fade('M40 352H200', 1, 0.6, 0.85);
  b.seq([rect(52, 380, 40, 40), 'M107 440V378H133V440', rect(148, 380, 40, 40)], 1, 0.65, 1, 'thin');

  // Stage 2: cottage.
  b.draw('M215 440V340H330V440', 2, 0, 0.45);
  b.draw('M205 346L272 282L340 346', 2, 0.3, 0.65);
  b.draw('M300 308V286H314V322', 2, 0.55, 0.75);
  b.seq(['M262 440V392H284V440', rect(228, 372, 26, 30), rect(296, 372, 26, 30)], 2, 0.6, 1, 'thin');

  // Stage 3: studio.
  b.draw('M345 440V250H450V440', 3, 0, 0.45);
  b.draw('M340 250H455', 3, 0.35, 0.55);
  b.draw(rect(360, 270, 75, 90), 3, 0.45, 0.75, 'thin');
  b.seq(['M397 270V360', 'M360 315H435', 'M360 440V380H390V440'], 3, 0.65, 1, 'thin');

  // Stage 4: crow-stepped gable and the sun.
  b.draw('M460 440V300H469V286H478V272H487V258H496V244H505V230H525V244H534V258H543V272H552V286H561V300H570V440', 4, 0, 0.55);
  b.seq([rect(478, 330, 22, 30), rect(530, 330, 22, 30), 'M505 440V392H525V440', rect(509, 262, 12, 16)], 4, 0.45, 0.85, 'thin');
  b.fade(circle(520, 110, 16), 4, 0.75, 1, 'sun');

  return {
    caption: 'Street elevation, Scottish practice',
    revisions: ['Tenement windows', 'Cottage', 'Studio', 'Crow-stepped gable'],
    items: b.items,
  };
}

export const scenes: Record<SceneId, () => Scene> = { elevation, plan, section, street };
