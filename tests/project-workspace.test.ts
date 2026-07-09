import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PlanningStatus, WarrantStatus } from '@prisma/client';
import { planningDateFieldsForStatus, warrantDateFieldsForStatus } from '../src/lib/application-record-fields';
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

assert.deepEqual(planningDateFieldsForStatus(PlanningStatus.NOT_STARTED), [], 'not started planning records hide date fields');
assert.deepEqual(planningDateFieldsForStatus(PlanningStatus.SUBMITTED), ['submissionDate'], 'submitted planning records show submission date');
assert.deepEqual(planningDateFieldsForStatus(PlanningStatus.VALIDATED), ['submissionDate', 'validDate', 'decisionTargetDate'], 'validated planning records show validation and target dates');
assert.deepEqual(planningDateFieldsForStatus(PlanningStatus.APPROVED), ['submissionDate', 'validDate', 'decisionDate'], 'approved planning records show decision date');
assert.deepEqual(warrantDateFieldsForStatus(WarrantStatus.NOT_STARTED), [], 'not started warrant records hide date fields');
assert.deepEqual(warrantDateFieldsForStatus(WarrantStatus.SUBMITTED), ['submissionDate', 'firstResponseTargetDate'], 'submitted warrant records show response dates');
assert.deepEqual(warrantDateFieldsForStatus(WarrantStatus.GRANTED), ['submissionDate', 'grantedDate', 'expiryDate'], 'granted warrant records show granted and expiry dates');

const projectsPage = fs.readFileSync('src/pages/projects/index.astro', 'utf8');
const projectDetailPage = fs.readFileSync('src/pages/projects/[id].astro', 'utf8');
const planningPage = fs.readFileSync('src/pages/projects/[id]/planning.astro', 'utf8');
const warrantPage = fs.readFileSync('src/pages/projects/[id]/building-warrant.astro', 'utf8');
const appShell = fs.readFileSync('src/components/layout/AppShell.astro', 'utf8');
assert.match(projectsPage, /organisationId:\s*auth\.organisation\.id/, 'projects list query is organisation scoped');
assert.match(projectDetailPage, /organisationId:\s*auth\.organisation\.id/, 'project workspace query is organisation scoped');
assert.match(projectsPage, /readyAutomationJobCount/, 'projects list includes ready automation job counts');
assert.match(projectDetailPage, /automationJobs/, 'project workspace loads automation jobs');
assert.doesNotMatch(appShell, /label: 'Documents'/, 'global Documents navigation is hidden while documents live inside projects');
assert.match(projectDetailPage, /View project files/, 'project document section links into the project files page instead of the global documents hub');
assert.match(planningPage, /data-planning-record-form/, 'planning page uses simplified quick-create form');
assert.match(planningPage, /Advanced details/, 'planning page keeps advanced details available');
assert.match(planningPage, /Prepare a planning automation job using this project's approved details and linked documents/, 'planning automation copy is secondary and specific');
assert.match(warrantPage, /data-warrant-record-form/, 'warrant page uses simplified quick-create form');
assert.match(warrantPage, /Advanced details/, 'warrant page keeps advanced details available');
assert.match(warrantPage, /Prepare a building warrant automation job using this project's approved details and linked documents/, 'warrant automation copy is secondary and specific');

console.log('project workspace tests passed');
