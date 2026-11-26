import assert from 'node:assert/strict';
import * as story from '../src/components/home/scroll-story/story.js';
import { windowMarkup, ledgerMarkup } from '../src/components/home/scroll-story/overlay.js';
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
assert.equal(story.poseAt(0.4).construction.cranes, 0, 'no cranes before construction');
assert.equal(story.poseAt(0.2).section.cut, 0, 'no section before the warrant');
assert.equal(story.themes.length, 5);

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
assert.doesNotMatch(planningFill, / · /, 'no dot-joined strings on screen');

console.log('homepage story tests passed');
