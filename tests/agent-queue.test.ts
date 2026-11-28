import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { AutomationJobStatus, AutomationJobType } from '@prisma/client';
import { planningApplicationFeeSchema } from '../src/lib/validation/domain';
import { jsonResponse } from '../src/lib/utils/http';
import { agentSupportsJob } from '../src/server/services/desktop-agent.service';
for (const [value, expected] of [['325.50', 325.5], ['0', 0], ['', undefined]] as const) assert.equal(planningApplicationFeeSchema.parse(value), expected);
for (const value of ['-1', '12.345', 'invalid', Infinity]) assert.equal(planningApplicationFeeSchema.safeParse(value).success, false);
const requests: any[] = [];
const records: any[] = Array.from({ length: 125 }, (_, index) => ({ id: `job-${index}`, organisationId: 'org-a', projectId: `project-${index % 3}`, status: 'READY', executionAuthorisedAt: new Date(index), createdAt: new Date(index), claimedByAgentId: null, events: [] }));
records.push({ ...records[0], id: 'foreign', organisationId: 'org-b' }, { ...records[0], id: 'draft', executionAuthorisedAt: null as any });
for (const status of ['CLAIMED', 'IN_PROGRESS', 'NEEDS_REVIEW', 'AWAITING_PORTAL_REVIEW', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'FAILED', 'COMPLETED', 'CANCELLED', 'STALE']) {
  records.push({ ...records[0], id: status, status });
}
records.push({ ...records[0], id: 'needs-attention', status: 'NEEDS_REVIEW', claimedByAgentId: 'agent' },
  { ...records[0], id: 'cancelling', status: 'CANCELLED', claimedByAgentId: 'agent', executionAuthorisedAt: null },
  { ...records[0], id: 'cancelled-released', status: 'CANCELLED', claimedByAgentId: 'agent', events: [{ eventType: 'execution_released' }] });
const matches = (job: any, where: any): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
  if (key === 'OR') return value.some((part: any) => matches(job, part));
  if (key === 'events') return !job.events.some((event: any) => event.eventType === value.none.eventType);
  if (value && typeof value === 'object') {
    if ('in' in value) return value.in.includes(job[key]);
    if ('not' in value) return job[key] !== value.not;
  }
  return job[key] === value;
});
const modules: any = {
  '@/lib/db/prisma': { prisma: { automationJob: { findMany: async (query: any) => {
    requests.push(query);
    const found = records.filter(job => matches(job, query.where));
    return query.take ? found.slice(0, query.take) : found;
  } } } },
  '@/server/permissions/authz': { requireOrganisation: async () => ({ organisation: { id: 'org-a' } }) },
  '@/lib/utils/handlers': { withErrorHandling: (fn: any) => fn() },
  '@/lib/utils/http': { jsonResponse },
};
const output = ts.transpileModule(fs.readFileSync('src/pages/api/automation-jobs/queue.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox: any = { exports: {}, require: (name: string) => { assert.ok(modules[name], name); return modules[name]; } };
vm.runInNewContext(output, sandbox);
const response = await sandbox.exports.GET({});
const data = await response.json();
assert.equal(data.active.length, 129, 'active queue includes recoverable claims and pending cancellation without truncation');
assert.equal(new Set(data.active.map((job: any) => job.projectId)).size, 3);
assert.ok(data.active.every((job: any) => job.organisationId === 'org-a' && (job.status !== 'READY' || job.executionAuthorisedAt)));
assert.equal(data.recent, undefined, 'queue is not a history list');
assert.ok(data.active.every((job: any) => ['READY', 'CLAIMED', 'IN_PROGRESS', 'NEEDS_REVIEW', 'CANCELLED'].includes(job.status)));
assert.ok(data.active.some((job: any) => job.id === 'cancelling'), 'cancellation remains visible until the Agent has stopped');
assert.ok(!data.active.some((job: any) => ['NEEDS_REVIEW', 'CANCELLED', 'cancelled-released'].includes(job.id)), 'historic and released attempts remain excluded');
assert.notEqual(data.active[0].status, 'READY', 'running/starting jobs precede waiting work');
assert.equal(requests[0].orderBy[0].executionAuthorisedAt, 'asc');
assert.match(response.headers.get('cache-control'), /no-store/);
console.log('Cross-project queue isolation, full active list, order and planning fee validation passed.');

// Exercise the desktop polling route with the real compatibility rules.
const capabilities = {
  workflows: [AutomationJobType.PLANNING_APPLICATION, AutomationJobType.BUILDING_WARRANT],
  snapshotVersions: [2],
  callbackContractVersions: [1],
  progressContractVersions: [1],
  documentUploadContractVersions: [1],
};
const olderAgent = { organisationId: 'org-a', capabilities };
const currentAgent = { ...olderAgent, capabilities: { ...capabilities, planningOwnershipContractVersions: [1] } };
let pollingAgent = olderAgent;
const ready = {
  organisationId: 'org-a', status: AutomationJobStatus.READY, payloadVersion: 2,
  executionAuthorisedAt: new Date(100), createdAt: new Date(100),
  type: AutomationJobType.BUILDING_WARRANT, dataSnapshot: { metadata: { documentUploadContractVersion: 1 } },
};
const desktopQueue = [
  ...Array.from({ length: 40 }, (_, index) => ({
    ...ready,
    id: `planning-${String(index).padStart(2, '0')}`,
    type: AutomationJobType.PLANNING_APPLICATION,
    dataSnapshot: { ...ready.dataSnapshot, planning: { answers: { soleOwner: false } } },
  })),
  ...Array.from({ length: 21 }, (_, index) => ({
    ...ready, id: `warrant-${String(index).padStart(2, '0')}`,
    executionAuthorisedAt: new Date(index < 10 ? 100 : 101),
    createdAt: new Date(index === 0 ? 100 : 101),
  })),
  { ...ready, id: 'excluded-org', organisationId: 'org-b' },
  { ...ready, id: 'excluded-draft', status: AutomationJobStatus.DRAFT },
  { ...ready, id: 'excluded-no-authorisation', executionAuthorisedAt: null },
];
const desktopRequests: any[] = [];
let removePageBoundary = false;
const desktopModules = {
  '@prisma/client': { AutomationJobStatus },
  '@/lib/db/prisma': { prisma: { automationJob: { findMany: async (query: any) => {
    desktopRequests.push(query);
    const { OR: after, ...where } = query.where;
    const compare = (first: any, second: any) =>
      Number(first.executionAuthorisedAt) - Number(second.executionAuthorisedAt)
      || Number(first.createdAt) - Number(second.createdAt)
      || first.id.localeCompare(second.id);
    const page = desktopQueue.filter(job => matches(job, where)).filter(job => !after || after.some((row: any) =>
      Object.entries(row).every(([key, value]: [string, any]) => {
        const actual = job[key as keyof typeof job];
        return 'gt' in Object(value) ? actual! > value.gt : Number(actual) === Number(value);
      }),
    )).sort(compare).slice(0, query.take);
    if (removePageBoundary && desktopRequests.length === 1) {
      desktopQueue.splice(desktopQueue.indexOf(page.at(-1)!), 1);
    }
    return page;
  } } } },
  '@/lib/server/rate-limit': { assertRateLimit: () => {}, rateLimitPolicies: {} },
  '@/lib/utils/handlers': { withErrorHandling: (fn: any) => fn() },
  '@/lib/utils/http': { jsonResponse },
  '@/server/auth/agent-credential': { requireAgentAuth: async () => pollingAgent },
  '@/server/services/desktop-agent.service': { agentSupportsJob, reconcileStaleAgentJobs: async () => {} },
};
const desktopOutput = ts.transpileModule(fs.readFileSync('src/pages/api/desktop/queue/index.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const desktopSandbox: any = { exports: {}, require: (name: keyof typeof desktopModules) => {
  assert.ok(desktopModules[name], name);
  return desktopModules[name];
} };
vm.runInNewContext(desktopOutput, desktopSandbox);
const oldPoll = await (await desktopSandbox.exports.GET({})).json();
assert.deepEqual(oldPoll.jobs.map((job: any) => job.id), desktopQueue.slice(40, 60).map(job => job.id));
assert.equal(oldPoll.pollAfterSeconds, 25);
assert.equal(desktopRequests.length, 3);
assert.ok(desktopRequests.every(query => query.take === 20));
assert.deepEqual(JSON.parse(JSON.stringify(desktopRequests[0].orderBy)), [
  { executionAuthorisedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' },
]);
assert.deepEqual(Object.keys(oldPoll.jobs[0]), ['id', 'workflowType', 'snapshotVersion', 'callbackContractVersion', 'progressContractVersion']);

pollingAgent = currentAgent;
desktopRequests.length = 0;
const newPoll = await (await desktopSandbox.exports.GET({})).json();
assert.deepEqual(newPoll.jobs.map((job: any) => job.id), desktopQueue.slice(0, 20).map(job => job.id));
assert.equal(desktopRequests.length, 1);

pollingAgent = olderAgent;
desktopRequests.length = 0;
removePageBoundary = true;
const concurrentPoll = await (await desktopSandbox.exports.GET({})).json();
assert.deepEqual(concurrentPoll.jobs, oldPoll.jobs, 'A removed page boundary must not hide later jobs');
console.log('Desktop polling skips incompatible pages, preserves FIFO ties and returns at most 20 compatible jobs.');
