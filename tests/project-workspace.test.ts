import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getProjectNextAction } from '../src/lib/projects/next-action';

const base = {
  projectId: 'project-1',
  stage: 'DESIGN',
  documentCount: 3,
  documentReviewCount: 0,
  hasLocationPlan: true,
  planningStatus: null,
  warrantStatus: null,
  readyAutomationJobCount: 0,
  nextDeadline: null,
};
const now = new Date('2026-08-10T12:00:00.000Z');

assert.equal(getProjectNextAction({ ...base, documentCount: 0 }, now).label, 'Upload documents');
assert.equal(getProjectNextAction({ ...base, hasLocationPlan: false }, now).label, 'Upload location plan');
assert.equal(getProjectNextAction({ ...base, documentReviewCount: 2 }, now).label, 'Review 2 document classifications');
assert.equal(getProjectNextAction({ ...base, planningStatus: 'FURTHER_INFORMATION_REQUESTED' }, now).label, 'Respond to planning information request');
assert.equal(getProjectNextAction({ ...base, stage: 'PLANNING', planningStatus: 'SUBMITTED' }, now).label, 'Await planning validation');
assert.equal(getProjectNextAction({ ...base, stage: 'BUILDING_WARRANT', warrantStatus: 'DRAFTING' }, now).label, 'Submit building warrant');
assert.equal(getProjectNextAction({ ...base, readyAutomationJobCount: 1 }, now).label, '1 automation job ready');
assert.equal(getProjectNextAction({ ...base, nextDeadline: { title: 'Client response', dueDate: '2026-08-14T12:00:00.000Z' } }, now).label, 'Upcoming deadline: 14 Aug');
assert.equal(getProjectNextAction({ ...base, nextDeadline: { title: 'Submit drawings', dueDate: '2026-08-09T12:00:00.000Z' } }, now).label, 'Overdue: Submit drawings');
assert.equal(getProjectNextAction(base, now).label, 'No action needed');

const projectsPage = fs.readFileSync('src/pages/projects/index.astro', 'utf8');
const projectDetailPage = fs.readFileSync('src/pages/projects/[id].astro', 'utf8');
assert.match(projectsPage, /organisationId:\s*auth\.organisation\.id/, 'projects list query is organisation scoped');
assert.match(projectDetailPage, /organisationId:\s*auth\.organisation\.id/, 'project workspace query is organisation scoped');
assert.match(projectsPage, /readyAutomationJobCount/, 'projects list includes ready automation job counts');
assert.match(projectDetailPage, /automationJobs/, 'project workspace loads automation jobs');

console.log('project workspace tests passed');
