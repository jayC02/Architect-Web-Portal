import assert from 'node:assert/strict';
import { buildProjectTimeline, timelineWeeks } from '../src/lib/dashboard/timeline';

const now = new Date('2026-11-23T12:00:00Z');
const day = 86_400_000;

// A planning application with the council: preparing, then with the council, then the expected run-on.
const planning = buildProjectTimeline({
  planning: { id: 'p', status: 'VALIDATED', createdAt: '2026-10-01T09:00:00Z', submissionDate: '2026-10-20T09:00:00Z', validDate: '2026-10-27T09:00:00Z', targetDate: '2026-12-15T09:00:00Z' },
}, now);
assert.deepEqual(planning.bars.map(bar => bar.state), ['preparing', 'council', 'projected']);
assert.equal(planning.bars[0].end, new Date('2026-10-20T09:00:00Z').getTime(), 'preparing ends at submission');
assert.equal(planning.bars[1].end, now.getTime(), 'with the council runs to today while undecided');
assert.equal(planning.bars[2].end, new Date('2026-12-15T09:00:00Z').getTime(), 'the run-on reaches the council target date');
assert.deepEqual(planning.markers.map(marker => marker.kind).sort(), ['submitted', 'target', 'validated']);

// A decided warrant: no run-on, a granted marker, and completion in progress after it.
const warrant = buildProjectTimeline({
  warrant: { id: 'w', status: 'GRANTED', createdAt: '2026-08-01T09:00:00Z', submissionDate: '2026-08-20T09:00:00Z', targetDate: '2026-10-01T09:00:00Z', decisionDate: '2026-09-25T09:00:00Z', completionCertificateStatus: 'SUBMITTED', completionPreparedAt: '2026-11-10T09:00:00Z' },
}, now);
assert.deepEqual(warrant.bars.map(bar => `${bar.phase}:${bar.state}`), ['warrant:preparing', 'warrant:decided', 'completion:council']);
assert.ok(warrant.markers.some(marker => marker.kind === 'approved' && marker.label === 'Building warrant granted'));
assert.ok(!warrant.markers.some(marker => marker.kind === 'target'), 'a decided application shows no outstanding target');

// A refused application is marked refused; an unstarted one draws nothing.
const refused = buildProjectTimeline({ planning: { id: 'r', status: 'REFUSED', createdAt: '2026-06-01', submissionDate: '2026-06-10', decisionDate: '2026-08-01' } }, now);
assert.ok(refused.markers.some(marker => marker.kind === 'refused'));
assert.deepEqual(buildProjectTimeline({ planning: { id: 'n', status: 'NOT_STARTED', createdAt: '2026-11-01' } }, now).bars, []);

// Drafting with no submission is still being prepared up to today.
const drafting = buildProjectTimeline({ planning: { id: 'd', status: 'DRAFTING', createdAt: '2026-11-10T09:00:00Z' } }, now);
assert.equal(drafting.bars.length, 1);
assert.equal(drafting.bars[0].end, now.getTime());

// Deadlines become markers; past ones are overdue.
const deadlines = buildProjectTimeline({ deadlines: [
  { id: 'a', title: 'Send drawings', dueDate: '2026-11-20T12:00:00Z' },
  { id: 'b', title: 'Site visit', dueDate: '2026-11-30T12:00:00Z' },
] }, now);
assert.deepEqual(deadlines.markers.map(marker => marker.kind), ['overdue', 'deadline']);

// Week columns start on Mondays and cover the window.
const weeks = timelineWeeks(now.getTime(), 3);
assert.equal(new Date(weeks[0].start).getUTCDay(), 1, 'weeks start on Monday');
assert.equal(weeks[2].end - weeks[0].start, 21 * day);

console.log('dashboard timeline tests passed');
