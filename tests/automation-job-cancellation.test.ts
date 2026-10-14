import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as enums from '@prisma/client';
import { lockOrganisationExecution, releaseAgentExecution, assertRegisteredAgentActive, assertExecutionAvailable } from '../src/server/services/desktop-execution.service';
import { agentHeartbeatSchema } from '../src/lib/validation/desktop-agent';
import { desktopJobStatusSchema } from '../src/lib/validation/desktop-handoff';
import { assertAllowedOrigin } from '../src/lib/server/origin-guard';
import { parseBody, withErrorHandling } from '../src/lib/utils/handlers';
import { HttpError, jsonResponse } from '../src/lib/utils/http';

const run = '11111111-1111-4111-8111-111111111111';
const jobId = 'job_cancellation_test';
const load = (file: string, modules: Record<string, any>) => {
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, console, require: (name: string) => {
    assert.ok(name in modules, name); return modules[name];
  } });
  return exports;
};

function harness(status = 'CLAIMED', options: { eventFails?: boolean; agentVersion?: string } = {}) {
  let state: any = { job: { id: jobId, organisationId: 'org', status,
    claimedByAgentId: 'agent', agentRunId: run, claimedDeviceId: 'device',
    executionAuthorisedAt: new Date(), dataSnapshot: { retained: true }, documentSnapshot: { retained: true } },
    events: [], currentJobId: jobId, ownership: [] };
  let tail = Promise.resolve();
  const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((part: any) => matches(row, part));
    if (key === 'events') return value.none
      ? !state.events.some((event: any) => event.eventType === value.none.eventType)
      : state.events.some((event: any) => event.eventType === value.some.eventType);
    if (value && typeof value === 'object' && 'not' in value) return row[key] !== value.not;
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
  const tx: any = {
    $executeRaw: async () => {}, $queryRaw: async () => [],
    automationJob: {
      findFirst: async ({ where }: any) => matches(state.job, where) ? structuredClone(state.job) : null,
      updateMany: async ({ where, data }: any) => {
        if (!matches(state.job, where)) return { count: 0 };
        state.job = { ...state.job, ...data }; return { count: 1 };
      },
    },
    automationJobEvent: {
      findFirst: async ({ where }: any) => state.events.find((event: any) => matches(event, where)) ?? null,
      create: async ({ data }: any) => {
        if (options.eventFails) throw new Error('event failed');
        state.events.push(data); return data;
      },
      upsert: async ({ where, create }: any) => {
        if (!state.events.some((event: any) => event.idempotencyKey === where.idempotencyKey)) state.events.push(create);
      },
    },
    agentRegistration: {
      findFirst: async ({ where }: any) => where.id === 'agent' && where.organisationId === 'org'
        && (!where.credentialHash || where.credentialHash === 'hash') ? { id: 'agent', agentVersion: options.agentVersion ?? '4.2.3' } : null,
      updateMany: async ({ where, data }: any) => {
        if (where.currentJobId && where.currentJobId !== state.currentJobId) return { count: 0 };
        if ('currentJobId' in data) state.currentJobId = data.currentJobId;
        return { count: 1 };
      },
    },
  };
  const database: any = { ...tx, $transaction: async (fn: any) => {
    const previous = tail; let unlock!: () => void;
    tail = new Promise<void>(resolve => { unlock = resolve; });
    await previous;
    const before = structuredClone(state);
    try { return await fn(tx); } catch (error) { state = before; throw error; } finally { unlock(); }
  } };
  const modules: Record<string, any> = {
    '@prisma/client': enums, '@/lib/db/prisma': { prisma: database }, '@/lib/utils/http': { HttpError, jsonResponse },
    '@/server/services/desktop-execution.service': { lockOrganisationExecution, releaseAgentExecution, assertRegisteredAgentActive },
    '@/server/services/desktop-agent.service': {
      waitingAgentActionKey: (id: string) => `waiting:${id}`, connectionLostActionKey: (id: string) => `lost:${id}`,
      resolveAgentAction: async () => {}, agentLeaseExpiry: () => new Date(), reconcileStaleAgentJobs: async () => {},
    },
    '@/server/services/automation-state-model.service': { recordAutomationOwnership: async (_tx: any, _scope: any, value: any) => state.ownership.push(value) },
  };
  const { cancelAutomationJob } = load('src/server/services/automation-queue.service.ts', modules);
  modules['@/server/services/automation-queue.service'] = { cancelAutomationJob };
  return { state: () => state, tx, database, modules, cancel: (extra = {}) => cancelAutomationJob({ organisationId: 'org', jobId, userId: 'user', database, ...extra }) };
}

const unstarted = harness();
assert.equal((await unstarted.cancel()).pending, false);
assert.equal(unstarted.state().job.status, 'CANCELLED');
assert.equal(unstarted.state().job.executionAuthorisedAt, null);
assert.deepEqual(unstarted.state().job.dataSnapshot, { retained: true });
assert.deepEqual(unstarted.state().job.documentSnapshot, { retained: true });
assert.equal(unstarted.state().currentJobId, null, 'an unstarted claim releases immediately');
await assertExecutionAvailable(unstarted.tx, 'org');
await unstarted.cancel();
assert.equal(unstarted.state().events.filter((event: any) => event.eventType === 'cancellation_requested').length, 1);

const running = harness('IN_PROGRESS');
assert.equal((await running.cancel()).pending, true);
await assert.rejects(assertExecutionAvailable(running.tx, 'org'), /Another application/);
assert.equal(await releaseAgentExecution(running.tx, 'org', 'agent', jobId, 'wrong-run'), false);
await assert.rejects(assertExecutionAvailable(running.tx, 'org'), /Another application/);
assert.equal(await releaseAgentExecution(running.tx, 'org', 'agent', jobId, run), true);
await assertExecutionAvailable(running.tx, 'org');
assert.equal((await running.cancel()).pending, false);

for (const status of ['COMPLETED', 'AWAITING_PORTAL_REVIEW', 'FAILED_FINAL']) {
  const finished = harness(status); await assert.rejects(finished.cancel(), /already finished/);
  assert.equal(finished.state().job.status, status);
}
const isolated = harness();
await assert.rejects(isolated.cancel({ organisationId: 'other-org' }), /not found/);
await assert.rejects(isolated.cancel({ agent: { id: 'agent', runId: 'other-run', credentialHash: 'hash' } }), /no longer assigned/);
await assert.rejects(isolated.cancel({ agent: { id: 'agent', runId: run, credentialHash: 'revoked-hash' } }), /revoked/);
assert.equal(isolated.state().job.status, 'CLAIMED');
const failed = harness('CLAIMED', { eventFails: true });
await assert.rejects(failed.cancel(), /event failed/);
assert.equal(failed.state().job.status, 'CLAIMED', 'failed cancellation rolls back atomically');
const concurrent = harness('IN_PROGRESS'); await Promise.all([concurrent.cancel(), concurrent.cancel()]);
assert.equal(concurrent.state().events.filter((event: any) => event.eventType === 'cancellation_requested').length, 1);
const oldAgent = harness('IN_PROGRESS', { agentVersion: '4.2.2' });
await assert.rejects(oldAgent.cancel(), /Update to Agent 4.2.3/);
assert.equal(oldAgent.state().job.status, 'IN_PROGRESS', 'older Agents cannot be left indefinitely cancelling');

const route = harness();
Object.assign(route.modules, {
  '@/lib/server/origin-guard': { assertAllowedOrigin },
  '@/lib/server/rate-limit': { assertRateLimit: () => {}, rateLimitPolicies: { desktop: {}, mutation: {} } },
  '@/lib/utils/handlers': { parseBody, withErrorHandling },
  '@/server/permissions/authz': { requireOrganisation: async () => ({ organisation: { id: 'org' }, user: { id: 'user' } }) },
  '@/lib/validation/desktop-agent': { agentHeartbeatSchema },
  '@/server/auth/agent-credential': { requireAgentAuth: async () => ({ id: 'agent', organisationId: 'org', credentialHash: 'hash' }) },
});
const cancelRoute = load('src/pages/api/automation-jobs/[id]/cancel.ts', route.modules).POST;
const request = new Request('https://portal.test/api/automation-jobs/job/cancel', { method: 'POST', headers: { Origin: 'https://portal.test' } });
assert.equal((await cancelRoute({ request, params: { id: jobId } })).status, 200);
const heartbeat = load('src/pages/api/desktop/heartbeat.ts', route.modules).POST;
const pulse = (agentRunId: string) => heartbeat({ request: new Request('https://portal.test/api/desktop/heartbeat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1,
    state: 'RUNNING', currentJobId: jobId, agentRunId, agentVersion: '4.2.3', capabilities: {
      workflows: ['BUILDING_WARRANT'], snapshotVersions: [2], callbackContractVersions: [1], progressContractVersions: [1] },
  }),
}) });
assert.deepEqual((await (await pulse(run)).json()).commands, [{ type: 'CANCEL_JOB', jobId, agentRunId: run }]);
assert.deepEqual((await (await pulse('22222222-2222-4222-8222-222222222222')).json()).commands, [], 'cancellation cannot target a newer or foreign run');
const restarted = harness('IN_PROGRESS'); await restarted.cancel();
const reconnect = load('src/pages/api/desktop/heartbeat.ts', { ...route.modules,
  '@/lib/db/prisma': { prisma: restarted.database },
}).POST;
const readyPulse = (currentJobId: string | null, agentRunId: string | null) => reconnect({ request: new Request('https://portal.test/api/desktop/heartbeat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1,
    state: 'READY', currentJobId, agentRunId, agentVersion: '4.2.3', capabilities: {
      workflows: ['BUILDING_WARRANT'], snapshotVersions: [2], callbackContractVersions: [1], progressContractVersions: [1] },
  }),
}) });
assert.deepEqual((await (await readyPulse(null, null)).json()).commands, [{ type: 'CANCEL_JOB', jobId, agentRunId: run }],
  'an idle Agent receives its interrupted cancellation after restart');
assert.equal((await (await readyPulse(jobId, run)).json()).releaseAcknowledged, true);
await assertExecutionAvailable(restarted.tx, 'org');

Object.assign(route.modules, {
  'node:crypto': { randomUUID: () => 'test-event' }, '@/lib/validation/desktop-handoff': { desktopJobStatusSchema },
  '@/server/auth/desktop-token': { assertDesktopJobAccess: () => {}, assertDesktopTokenActive: async () => {},
    requireDesktopAuth: async () => ({ id: 'device', organisationId: 'org' }) },
  '@/server/services/automation-lifecycle.service': { assertAutomationJobTransition: () => assert.fail('a cancelled job must never transition') },
  '@/server/services/prepared-application-review.service': {},
});
const callback = load('src/pages/api/desktop/automation-jobs/[id]/index.ts', route.modules).PATCH;
const result = (eventType: string, status: string) => callback({ params: { id: jobId }, request: new Request('https://portal.test/callback', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, jobId,
    callbackId: '33333333-3333-4333-8333-333333333333', occurredAt: new Date().toISOString(), eventType, status }),
}) });
assert.equal((await result('started', 'IN_PROGRESS')).status, 409, 'cancel wins against delayed browser startup');
assert.equal((await result('result', 'COMPLETED')).status, 200, 'late results drain without reviving cancelled work');
assert.equal(route.state().job.status, 'CANCELLED');
console.log('Cancellation: retained applications, safe release, stale-command isolation, rollback, concurrent requests and late callback fencing passed.');
