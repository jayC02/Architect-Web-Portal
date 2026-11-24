import assert from 'node:assert/strict';
import { buildDashboardActivity } from '../src/lib/dashboard/activity';

const now = new Date('2026-11-24T12:00:00Z');
const activity = buildDashboardActivity({
  planning: [
    { status: 'APPROVED', submissionDate: '2026-11-03T10:00:00Z', decisionDate: '2026-11-20T10:00:00Z' },
    { status: 'REFUSED', submissionDate: '2026-10-10T10:00:00Z', decisionDate: '2026-11-01T10:00:00Z' },
    { status: 'VALIDATED', submissionDate: '2026-10-31T23:30:00Z' }, // 23:30 GMT on 31 October stays in October.
    { status: 'DRAFTING' },
  ],
  warrant: [
    { status: 'GRANTED', submissionDate: '2026-11-05T10:00:00Z', decisionDate: '2026-09-01T10:00:00Z' },
    { status: 'SUBMITTED', submissionDate: '2025-12-15T10:00:00Z' },
  ],
}, now);

assert.equal(activity.months.length, 12);
assert.deepEqual(activity.months[11], { label: 'Nov', planning: 1, warrant: 1 }, 'this month counts submissions by type');
assert.deepEqual(activity.months[10], { label: 'Oct', planning: 2, warrant: 0 });
assert.deepEqual(activity.months[0], { label: 'Dec', planning: 0, warrant: 1 }, 'the window is the last twelve months');
assert.equal(activity.submittedThisMonth, 2);
assert.equal(activity.submittedLastMonth, 2);
assert.equal(activity.quarters[7].label, 'Q4 26');
assert.deepEqual(activity.quarters[7], { label: 'Q4 26', planning: 3, warrant: 1 });
assert.deepEqual(activity.years.map(year => year.label), ['2022', '2023', '2024', '2025', '2026']);
assert.deepEqual(activity.decisions, { approved: 2, refused: 1, approvalRate: 66.7, approvedThisMonth: 1, withCouncil: 2 });
assert.equal(buildDashboardActivity({ planning: [], warrant: [] }, now).decisions.approvalRate, null, 'no decisions means no rate');

console.log('dashboard activity tests passed');
