import assert from 'node:assert/strict';
import type { APIContext } from 'astro';
import { prisma } from '../src/lib/db/prisma';
import { dashboardAutomationState, currentDashboardJobs, dashboardDayKey, dashboardDeadlineWindow, dashboardPhase, dashboardPreparationCurrent } from '../src/lib/dashboard/overview';
import { getDashboardSummary, GET } from '../src/pages/api/dashboard/summary';
import { GET as calendarGET } from '../src/pages/api/calendar/index';
import { GET as documentHubGET } from '../src/pages/api/documents/hub';
import { getCalendarGridRange } from '../src/lib/calendar/month';

const now = new Date('2026-10-22T23:30:00Z'); // Already 23 October in London.
assert.equal(dashboardDayKey(now), '2026-10-23');
assert.equal(dashboardDeadlineWindow(now, 7).lastDay, '2026-10-29');
assert.equal(dashboardDayKey('2026-10-29T23:59:59Z'), '2026-10-29', 'the last evening is included after DST ends');
assert.equal(dashboardDayKey('2026-07-22T23:30:00Z'), '2026-07-23', 'BST midnight uses the next calendar day');
assert.equal(dashboardDeadlineWindow(new Date('2026-03-28T12:00:00Z'), 7).lastDay, '2026-04-03', 'spring DST does not shorten the range');
assert.equal(dashboardDeadlineWindow(new Date('2026-07-22T12:00:00Z'), 7).queryEnd.toISOString(), '2026-07-28T22:59:59.999Z', 'BST target windows stop at London midnight');
assert.equal(dashboardDeadlineWindow(now, 7).queryEnd.toISOString(), '2026-10-29T23:59:59.999Z', 'GMT target windows include the whole last evening');
assert.equal(dashboardPhase('LEAD', 'COMPLETED'), 'complete', 'completed projects do not remain in the lead bucket');
assert.equal(dashboardPhase('ARCHIVED', 'ACTIVE'), null);
assert.equal(dashboardPhase('SURVEY', 'ON_HOLD'), 'documents');
const job = { id: 'job', projectId: 'project', type: 'HOUSEHOLDER_PLANNING', applicationId: 'application', createdAt: now, status: 'READY', preparedAt: now, executionAuthorisedAt: null, leaseExpiresAt: null, agentHeartbeatAt: null };
assert.equal(dashboardAutomationState(job, now), 'ready');
assert.equal(dashboardAutomationState({ ...job, executionAuthorisedAt: now }, now), 'queued');
assert.equal(dashboardAutomationState({ ...job, status: 'CLAIMED' }, now), 'connectionLost', 'a historical claim is not a running agent');
assert.equal(dashboardAutomationState({ ...job, status: 'IN_PROGRESS', agentHeartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + 120000) }, now), 'running');
assert.equal(dashboardAutomationState({ ...job, status: 'IN_PROGRESS', agentHeartbeatAt: new Date(now.getTime() - 91_000), leaseExpiresAt: new Date(now.getTime() + 120000) }, now), 'connectionLost', 'heartbeat health agrees with the existing Agent');
assert.equal(dashboardAutomationState({ ...job, applicationId: null }, now), 'needsAttention');
assert.equal(dashboardAutomationState({ ...job, preparedAt: null }, now), 'needsAttention');
assert.equal(dashboardAutomationState({ ...job, status: 'CANCELLED' }, now), 'history');
assert.equal(dashboardPreparationCurrent('READY', now, now), true);
assert.equal(dashboardPreparationCurrent('READY', now, new Date(now.getTime() + 1)), false, 'a READY job with changed application data is not ready to queue');
assert.equal(dashboardPreparationCurrent('NEEDS_INPUT', now, now), false);
assert.equal(dashboardPreparationCurrent('READY', null, now), false);
assert.equal(dashboardPreparationCurrent(null, now, null), false);
assert.deepEqual(currentDashboardJobs([{ ...job, id: 'old', status: 'CLAIMED', createdAt: new Date(0) }, job]).map(item => item.id), ['old'], 'an unresolved claim retains execution ownership ahead of a newer preparation');
assert.equal(currentDashboardJobs([job, { ...job, id: 'warrant', type: 'BUILDING_WARRANT' }]).length, 2, 'planning and warrant remain separate workflows');

const restore: Array<() => void> = [];
const mock = (object: any, key: string, implementation: any) => { const original = object[key]; restore.push(() => { object[key] = original; }); object[key] = implementation; };
const queries: any[] = [];
const projects = Array.from({ length: 9 }, (_, index) => ({ id: `project-${index}`, name: `Project ${index}`, internalReference: null, stage: index === 8 ? 'LEAD' : 'PLANNING', status: 'ACTIVE', siteAddress: null, client: null, site: null, documents: [{ type: 'LOCATION_PLAN', status: index === 8 ? 'REJECTED' : 'APPROVED' }], deadlines: index === 0 ? [{ title: 'Old deadline', dueDate: new Date('2026-10-21T12:00Z') }] : [], planningApplications: [], warrantApplications: [], _count: { documents: 1 } }));
projects[1].documents = [{ type: 'SITE_PLAN', status: 'APPROVED' }];
projects[2].documents = [{ type: 'BLOCK_PLAN', status: 'APPROVED' }];
projects[3].documents = [{ type: 'SITE_PLAN', status: 'REJECTED' }];
projects[4].documents = [{ type: 'BLOCK_PLAN', status: 'SUPERSEDED' }];
projects[5].documents = [{ type: 'SITE_PLAN', status: 'IN_REVIEW' }];
projects[6].documents = [{ type: 'SITE_PLAN', status: 'DRAFT' }];
projects[7].documents = [{ type: 'PROPOSED_DRAWING', status: 'APPROVED' }];
const deadline = (id: string, dueDate: string) => ({ id, title: id, dueDate, status: 'OVERDUE', project: { id: projects[0].id, name: projects[0].name } });
try {
  mock(prisma, '$queryRaw', async () => [{ activeProjects: 9, planningActionCount: 2, warrantActionCount: 1, planningAwaitingAction: [], warrantsAwaitingAction: [], upcomingDeadlines: [deadline('old', '2026-10-21T12:00Z'), deadline('today', '2026-10-22T23:30Z'), deadline('last-evening', '2026-10-29T23:59:59Z'), deadline('outside-range', '2026-10-30T00:00Z')] }]);
  mock(prisma.projectDocument, 'count', async () => 3);
  mock(prisma.projectDocument, 'groupBy', async () => [{ status: 'IN_REVIEW', _count: { _all: 3 } }, { status: 'APPROVED', _count: { _all: 4 } }, { status: 'DRAFT', _count: { _all: 2 } }, { status: 'REJECTED', _count: { _all: 1 } }, { status: 'SUPERSEDED', _count: { _all: 2 } }]);
  mock(prisma.automationJob, 'findMany', async (query: any) => { queries.push(query); return []; });
  mock(prisma.actionItem, 'findMany', async (query: any) => { queries.push(query); assert.deepEqual(query.where.availableAt, { lte: now }); return []; });
  mock(prisma.project, 'findMany', async (query: any) => {
    queries.push(query);
    assert.equal(query.take, undefined, 'search and attention must not be limited to six database rows');
    if (query.where.documents) return [{ id: 'project-0', name: 'Project 0', _count: { documents: 3 } }];
    if (query.select.documents) {
      assert.deepEqual(query.select.documents.where.OR, [
        { status: 'IN_REVIEW' },
        { type: { in: ['LOCATION_PLAN', 'SITE_PLAN', 'BLOCK_PLAN'] }, status: { notIn: ['REJECTED', 'SUPERSEDED'] } },
      ], 'the database selection must actually load site/block fallback candidates and preserve review counts');
    }
    return query.select.stage && !query.select.id ? projects.map(({ stage, status }) => ({ stage, status })) : projects;
  });
  const data = await getDashboardSummary('practice', new URLSearchParams('deadlineRange=7'), now);
  assert.equal(data.activeProjectSummaries.length, 9);
  assert.equal(data.documentOverview.reviewed, 4, 'only approved documents are described as approved');
  assert.equal(data.documentOverview.total, 12);
  assert.equal(data.documentOverview.projects[0].count, 3);
  assert.deepEqual(data.upcomingDeadlines.map((item: any) => item.id), ['old', 'today', 'last-evening']);
  assert.equal(data.actionWorkload.overdueDeadlines, 1, 'stored OVERDUE does not make today or future dates overdue');
  assert.equal(data.activeProjectSummaries[0].nextAction.href, '/projects/project-0#deadlines');
  assert.equal(data.activeProjectSummaries[8].nextAction.label, 'Upload location plan', 'a rejected location plan does not satisfy the missing document check');
  for (const index of [1, 2, 6]) assert.equal(data.activeProjectSummaries[index].nextAction.label, 'Prepare planning application', 'available site/block plans remove the incorrect upload next action');
  assert.equal(data.activeProjectSummaries[5].nextAction.label, 'Review 1 document classification', 'a pending fallback still requires review');
  for (const index of [3, 4, 7]) assert.equal(data.activeProjectSummaries[index].nextAction.label, 'Upload location plan');
  assert.deepEqual(data.missingDocumentWarnings.map(item => item.project.id), ['project-3', 'project-4', 'project-7', 'project-8']);
  assert.deepEqual(data.needsAttention.filter(item => item.type === 'Missing location plan').map(item => item.projectName).sort(), ['Project 3', 'Project 4', 'Project 7', 'Project 8']);
  assert.ok(data.needsAttention.every(item => !item.href.startsWith('/deadlines?')));
  assert.ok(queries.every(query => query.where.organisationId === 'practice'), 'every Prisma read is scoped to the authenticated practice');
  const response = await GET({ request: new Request('http://localhost/api/dashboard/summary'), cookies: { get: () => undefined } } as unknown as APIContext);
  assert.equal(response.status, 401);
  mock(prisma.session, 'findUnique', async () => ({ id: 'test-session', expiresAt: new Date(Date.now() + 90 * 86400000), lastSeenAt: new Date(), user: { id: 'test-user', organisationLinks: [{ role: 'MEMBER', organisation: { id: 'practice' } }] } }));
  let calendarQuery: any;
  mock(prisma.deadline, 'findMany', async (query: any) => { calendarQuery = query; return []; });
  mock(prisma.calendarConnection, 'findUnique', async () => null);
  const calendarContext = (suffix: string) => ({ request: new Request(`http://localhost/api/calendar?month=2026-07${suffix}`), cookies: { get: () => ({ value: 'test-session' }) } }) as unknown as APIContext;
  const { gridStart, gridEnd } = getCalendarGridRange('2026-07');
  await calendarGET(calendarContext(''));
  assert.deepEqual(calendarQuery.where.dueDate, { gte: gridStart, lt: gridEnd }, 'the existing calendar page keeps exactly its previous date query');
  await calendarGET(calendarContext('&dashboardDates=true'));
  assert.deepEqual(calendarQuery.where.dueDate, { gte: new Date(gridStart.getTime() - 86400000), lt: gridEnd }, 'the dashboard includes London midnight at the start of its calendar grid');
  assert.equal(calendarQuery.where.organisationId, 'practice');
  mock(prisma.project, 'findMany', async (query: any) => {
    assert.equal(query.where.organisationId, 'practice', 'document folder checks remain tenant scoped');
    if (query.where.documents) {
      assert.deepEqual(query.where.documents.none, {
        type: { in: ['LOCATION_PLAN', 'SITE_PLAN', 'BLOCK_PLAN'] },
        status: { notIn: ['REJECTED', 'SUPERSEDED'] },
      }, 'folder missing counts must query all eligible location-plan types');
      return [3, 4, 7, 8].map(index => ({ id: `project-${index}` }));
    }
    return projects;
  });
  mock(prisma.projectDocument, 'findMany', async () => []);
  const hubResponse = await documentHubGET({ request: new Request('http://localhost/api/documents/hub'), cookies: { get: () => ({ value: 'test-session' }) } } as unknown as APIContext);
  assert.equal(hubResponse.status, 200);
  const hub = await hubResponse.json();
  assert.equal(hub.missingLocationCount, 4);
  assert.deepEqual(hub.projects.filter((project: any) => project.missingLocationPlan).map((project: any) => project.id), ['project-3', 'project-4', 'project-7', 'project-8']);
  console.log('Dashboard date boundaries, stages, document states, automation, full-register search, tenant scope and authentication passed.');
} finally { restore.reverse().forEach(reset => reset()); await prisma.$disconnect(); }
