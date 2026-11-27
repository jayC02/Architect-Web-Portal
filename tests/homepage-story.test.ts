import assert from 'node:assert/strict';
import * as story from '../src/components/home/scroll-story/story.js';
import { windowMarkup, ledgerMarkup } from '../src/components/home/scroll-story/overlay.js';
import { anchorFromRect, ANCHOR_FALLBACK } from '../src/components/home/scroll-story/scene/anchor.js';
import { calculateBuildingStandardsFee } from '../src/lib/fees/building-standards-fee';

const samples = Array.from({ length: 2001 }, (_, i) => i / 2000);

// Chapters and numbers
assert.deepEqual(story.acts.map(a => a.name), ['Planning', 'Building warrant', 'Construction', 'Completion', 'Time back']);
assert.deepEqual(story.acts.map(a => a.start), [0, 0.27, 0.5, 0.66, 0.86]);
story.acts.forEach((a, i) => assert.equal(story.actAt(a.jump), i, `jump lands in ${a.name}`));
assert.deepEqual([story.MANUAL_MIN, story.AUTO_MIN, story.SAVED_MIN], [60, 4, 56]);
assert.deepEqual(story.APPLICATIONS.map(a => [a.key, a.manualMin, a.autoMin, a.fee]),
  [['planning', 15, 1, 'entered'], ['warrant', 25, 1.5, 'calculated'], ['completion', 20, 1.5, 'none']]);

// Ledger: holds the pinned values between chapters and never falls
assert.deepEqual(story.ledgerAt(0), { manual: 0, auto: 0 });
assert.deepEqual(story.ledgerAt(0.26), { manual: 15, auto: 1 });
assert.deepEqual(story.ledgerAt(0.49), { manual: 40, auto: 2.5 });
assert.deepEqual(story.ledgerAt(1), { manual: 60, auto: 4 });
samples.slice(1).forEach((p, i) => {
  const a = story.ledgerAt(samples[i]), b = story.ledgerAt(p);
  assert.ok(b.manual >= a.manual && b.auto >= a.auto, `ledger never falls at ${p}`);
});

// Window: pure, honest about fees
samples.forEach(p => assert.deepEqual(story.windowAt(p), story.windowAt(p), 'pure'));
const fee = (p: number) => story.windowAt(p).fee?.text;
assert.equal(fee(0.22), 'Planning fee · added by you');
const warrantFee = calculateBuildingStandardsFee({ submissionType: 'BUILDING_WARRANT', valueOfWorksMinorUnits: 8500000, effectiveDate: '2026-11-26', workStartedBeforeApplication: false, disabledPersonsFacilitiesOnly: false });
assert.ok(warrantFee.calculationStatus === 'CALCULATED' && warrantFee.totalFeeMinorUnits === 129000, 'the example fee comes from the real calculator');
assert.equal(fee(0.44), 'Fee calculated · £1,290.00');
assert.equal(fee(0.8), 'No fee');
samples.filter(p => story.windowAt(p).app === 'completion').forEach(p => assert.notEqual(story.windowAt(p).kind, 'pay', 'completion never asks for payment'));

// Copy rules
story.beats.filter(b => b.app === 'planning').forEach(b => assert.ok(!/calculat/i.test(b.headline + b.line), 'planning never claims a calculated fee'));
story.beats.forEach(b => {
  assert.ok(b.headline.split(/\s+/).length <= 8, `headline length: ${b.headline}`);
  assert.ok(b.line.length <= 110, `line length: ${b.line}`);
  assert.ok(!/—/.test(b.headline + b.line), 'no em dashes');
});
assert.ok(!story.beats.some(b => b.kind === 'uvalue' && /drop/i.test(b.headline + b.line)), 'no drop-in U-value claim');
assert.deepEqual(story.windowAt(0.9).statuses.map(s => s.label), ['Approved', 'Approved', 'Accepted']);

// Pose
samples.forEach(p => {
  const flat = JSON.stringify(story.poseAt(p)).match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number);
  assert.ok(flat.every(Number.isFinite), `finite pose at ${p}`);
});
// The opening: a blank sheet, a new house sketched (full planning permission), the sketch made
// solid, then an extension sketched onto it (householder), then the documents are collected
const opening = (p: number) => story.poseAt(p);
assert.deepEqual([...opening(0).house.draw, opening(0).house.solid], [0, 0, 0], 'the story opens on a blank sheet');
assert.ok(opening(0.05).house.draw[0] > 0 && opening(0.05).house.solid === 0, 'the house is a line sketch before it is a model');
assert.ok(opening(0.05).house.draw[0] > opening(0.05).house.draw[1], 'it is drawn from the ground up');
assert.deepEqual(opening(0.072).house.draw, [1, 1], 'the whole house is sketched');
assert.equal(opening(0.072).plan, 0, 'and only then is the extension sketched onto it');
assert.ok(opening(0.072).house.solid < opening(0.09).house.solid, 'the sketch becomes the model');
assert.ok(opening(0.085).plan > 0 && opening(0.085).studio.draw === 0, 'the extension is drawn as a plan first');
assert.ok(opening(0.1).studio.draw > 0 && opening(0.1).studio.solid === 0, 'then sketched in 3D, like the house');
assert.equal(opening(0.12).house.solid, 1, 'solid before the documents are collected');
assert.equal(opening(0.12).studio.solid, 1, 'and solid before the documents fly');
const designBeats = story.beats.filter(b => b.chapter === 0 && b.kind === 'design');
assert.equal(designBeats.length, 2, 'one beat for the house sketch, one for the extension');
assert.match(designBeats[0].line, /full planning permission/i);
assert.match(designBeats[1].line, /householder/i);
assert.ok(designBeats[0].at < opening(0.05).p && designBeats[1].at >= 0.072, 'each beat lands with its sketch');

assert.equal(story.poseAt(0.4).construction.cranes, 0, 'no cranes before construction');
assert.equal(story.poseAt(0.2).section.cut, 0, 'no section before the warrant');
assert.equal(story.themes.length, 5);
assert.deepEqual(story.poseAt(0.12).sheets.map(g => g.t), [0, 0, 0], 'planning sheets start as collection starts');
assert.equal(story.poseAt(0.17).sheets[0].t, 1, 'and are all in the window when filling starts');
assert.equal(story.poseAt(0.79).sheets[2].t, 1);

const tapped = samples.filter(p => story.windowAt(p).kind === 'pay' && story.windowAt(p).payTapped);
assert.ok(tapped.some(p => story.windowAt(p).app === 'planning') && tapped.some(p => story.windowAt(p).app === 'warrant'), 'the Pay tap is on screen before the run starts');

// Overlay markup
const planningFill = windowMarkup(story.windowAt(0.19));
assert.match(planningFill, /data-app="planning"/);
assert.match(planningFill, /Second-floor studio extension with roof terrace/);
assert.match(planningFill, /from Design statement/);
assert.match(windowMarkup(story.windowAt(0.44)), /£1,290\.00/);
assert.doesNotMatch(windowMarkup(story.windowAt(0.8)), /data-action="pay"/);
assert.match(windowMarkup(story.windowAt(0.34)), /0\.17 W\/m²K/);
assert.match(ledgerMarkup({ manual: 40, auto: 2.5 }), /40 min/);
assert.match(ledgerMarkup({ manual: 40, auto: 2.5 }), /2\.5 min/);
assert.equal(windowMarkup({ ...story.windowAt(0.19), visible: false }), '');

// Planning covers both kinds of planning application, and the window picks the one the proposal needs
assert.equal(story.APPLICATIONS[0].name, 'Planning permission');
const reading = story.windowAt(0.14);
assert.deepEqual(reading.planningType, { options: ['Householder', 'Full planning permission'], chosen: null }, 'both planning types listed while the documents are read');
assert.equal(story.windowAt(0.19).planningType?.chosen, 0, 'householder chosen for an alteration once the proposal is read');
assert.match(planningFill, /data-k="type-0" class="on"/);
assert.match(planningFill, /Full planning permission/);
assert.equal(story.windowAt(0.44).planningType, null, 'only the planning window shows the planning type');
assert.doesNotMatch(windowMarkup(story.windowAt(0.44)), /aw-type/);
assert.ok(story.beats.some(b => b.app === 'planning' && /full planning permission/i.test(b.line)), 'the story says it handles full planning permission too');
assert.doesNotMatch(planningFill, / · /, 'no dot-joined strings on screen');

// Where sheets fly to: the window's centre in normalised device coordinates
const vp = { width: 1000, height: 800 };
assert.deepEqual(anchorFromRect({ left: 400, top: 300, width: 200, height: 200 }, vp), { x: 0, y: 0 });
const corner = anchorFromRect({ left: 700, top: 50, width: 250, height: 200 }, vp);
assert.ok(corner.x > 0 && corner.y > 0, 'top-right window gives a top-right anchor');
assert.deepEqual(anchorFromRect(null, vp), ANCHOR_FALLBACK);
assert.deepEqual(anchorFromRect({ left: 10, top: 10, width: 0, height: 120 }, vp), ANCHOR_FALLBACK);
assert.deepEqual(anchorFromRect({ left: 10, top: 10, width: 100, height: 100 }, { width: 0, height: 0 }), ANCHOR_FALLBACK);
[[null, vp], [{ left: NaN, top: 1, width: 1, height: 1 }, vp]].forEach(([r, v]) => {
  const a = anchorFromRect(r as never, v);
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y), 'never NaN');
});

console.log('homepage story tests passed');
