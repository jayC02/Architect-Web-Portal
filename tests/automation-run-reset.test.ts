import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as enums from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { automationJobApplicationId, desktopAutomationJobSelect, selectCurrentAutomationJob } from '../src/server/services/desktop-automation-status.service';
import { assertExecutionAvailable, lockOrganisationExecution, releaseAgentExecution } from '../src/server/services/desktop-execution.service';
import { agentSupportsJob } from '../src/server/services/desktop-agent.service';
import { HttpError } from '../src/lib/utils/http';
import { jsonResponse } from '../src/lib/utils/http';
import { parseBody, withErrorHandling } from '../src/lib/utils/handlers';
import { z } from 'zod';

const load = (file: string, modules: Record<string, unknown>) => {
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, Date, Set, console, require: (name: string) => {
    assert.ok(name in modules, name); return modules[name];
  } });
  return exports;
};

function harness(type = 'HOUSEHOLDER_PLANNING', status = 'FAILED_FINAL', options: { failCreate?: boolean; failSnapshot?: boolean; preflight?: string; applicationStatus?: string; noJob?: boolean } = {}) {
  const snapshot = (id: string, applicationId: string, jobType = type) => ({
    contractVersion: 'architectpro.automation-job', snapshotVersion: 2,
    metadata: { jobId: id, projectId: 'project', applicationType: jobType },
    planning: jobType === 'BUILDING_WARRANT' ? null : { recordId: applicationId },
    buildingWarrant: jobType === 'BUILDING_WARRANT' ? { recordId: applicationId } : null,
    site: { address: { addressLine1: '6 West Ferryfield' } },
  });
  let state: any = {
    applications: [{ id: 'application', organisationId: 'org', projectId: 'project', kind: type,
      status: options.applicationStatus ?? 'DRAFTING', preparationData: { soleOwner: true, certifier: { registration: 'saved' } },
      description: 'Saved description', presetKey: 'domestic_alteration_extension', presetVersion: 1,
      submissionDate: options.applicationStatus === 'SUBMITTED' ? new Date('2026-10-28') : null,
      applicationReference: 'keep-official-reference', warrantReference: 'keep-warrant-reference' }],
    jobs: options.noJob ? [] : [{ id: 'old', organisationId: 'org', projectId: 'project', type, status,
      dataSnapshot: snapshot('old', 'application'), documentSnapshot: { old: true }, error: 'Old upload error', resultData: { original: true },
      claimedAt: ['CLAIMED', 'IN_PROGRESS', 'NEEDS_REVIEW', 'AWAITING_PORTAL_REVIEW'].includes(status) ? new Date('2026-10-28') : null,
      claimedByAgentId: ['CLAIMED', 'IN_PROGRESS', 'NEEDS_REVIEW', 'AWAITING_PORTAL_REVIEW'].includes(status) ? 'agent' : null,
      agentRunId: ['CLAIMED', 'IN_PROGRESS', 'NEEDS_REVIEW', 'AWAITING_PORTAL_REVIEW'].includes(status) ? 'execution' : null,
      preparedAt: new Date('2026-10-28'), updatedAt: new Date('2026-10-28'), createdAt: new Date('2026-10-28') }],
    events: [], builds: [], agentJob: 'old', currentAddress: '2 West Ferryfield', documents: ['current.pdf'], ownership: [],
  };
  const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((part: any) => matches(row, part));
    if (key === 'events') return !state.events.some((event: any) => event.automationJobId === row.id && event.eventType === value.none.eventType);
    if (key === 'payload') return value.path.reduce((object: any, part: string) => object?.[part], row.payload) === value.equals;
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
    }
    return row[key] === value;
  });
  const applications = (kind: string) => ({
    findFirst: async ({ where }: any) => structuredClone(state.applications.find((row: any) => row.kind === kind && matches(row, where)) ?? null),
    update: async ({ where, data }: any) => { const row = state.applications.find((row: any) => row.id === where.id && row.kind === kind); Object.assign(row, data); return structuredClone(row); },
    create: async ({ data }: any) => { const row = { id: `draft-${state.applications.length}`, ...data, kind }; state.applications.push(row); return structuredClone(row); },
  });
  const tx: any = {
    $executeRaw: async () => {},
    planningApplication: applications('HOUSEHOLDER_PLANNING'), buildingWarrantApplication: applications('BUILDING_WARRANT'),
    automationJob: {
      findFirst: async ({ where }: any) => structuredClone(state.jobs.find((row: any) => matches(row, where)) ?? null),
      findMany: async ({ where }: any) => structuredClone(state.jobs.filter((row: any) => matches(row, where))),
      updateMany: async ({ where, data }: any) => { const rows = state.jobs.filter((row: any) => matches(row, where)); rows.forEach((row: any) => Object.assign(row, data)); return { count: rows.length }; },
      create: async ({ data }: any) => { if (options.failCreate) throw new Error('create failed'); const row = { ...data, error: null, resultData: null, claimedAt: null, claimedByAgentId: null, agentRunId: null, updatedAt: new Date() }; state.jobs.push(row); return structuredClone(row); },
    },
    automationJobEvent: {
      findUnique: async ({ where }: any) => structuredClone(state.events.find((row: any) => row.idempotencyKey === where.idempotencyKey) ?? null),
      findFirst: async ({ where }: any) => structuredClone(state.events.find((row: any) => matches(row, where)) ?? null),
      create: async ({ data }: any) => { state.events.push(data); return data; },
      upsert: async ({ where, create }: any) => { const prior = state.events.find((row: any) => row.idempotencyKey === where.idempotencyKey); if (prior) return prior; state.events.push(create); return create; },
    },
    agentRegistration: { updateMany: async ({ where, data }: any) => { if (!where.currentJobId || where.currentJobId === state.agentJob) state.agentJob = data.currentJobId; return { count: 1 }; } },
    actionItem: { updateMany: async () => ({ count: 0 }) }, deadline: { updateMany: async () => ({ count: 0 }) },
  };
  let tail = Promise.resolve();
  const database = { $transaction: async (fn: any) => {
    const beforeTurn = tail; let unlock!: () => void;
    tail = new Promise<void>(resolve => { unlock = resolve; });
    await beforeTurn;
    const before = structuredClone(state);
    try { return await fn(tx); } catch (cause) { state = before; throw cause; } finally { unlock(); }
  } };
  const modules = {
    'node:crypto': { randomUUID }, '@prisma/client': enums, '@/lib/db/prisma': { prisma: database }, '@/lib/utils/http': { HttpError },
    '@/server/services/desktop-automation-status.service': { automationJobApplicationId, desktopAutomationJobSelect, selectCurrentAutomationJob },
    '@/server/services/desktop-execution.service': { lockOrganisationExecution, releaseAgentExecution },
    '@/server/services/automation-state-model.service': { recordAuthorisedSnapshot: async () => {}, recordAutomationOwnership: async (_tx: any, _scope: any, change: any) => state.ownership.push(change) },
    '@/server/services/phase2-workflow-handlers.service': { workflowActionKeys: { warrantFinalReview: (id: string) => `warrant:${id}`, planningFinalReview: (id: string) => `planning:${id}` } },
    '@/server/services/automation-jobs.service': { buildFreshAutomationJob: async (input: any, transaction: any) => {
      assert.equal(transaction, tx, 'snapshot reads stay inside the reset transaction');
      assert.equal(input.documentIds, undefined, 'reset uses the current reviewed document set');
      if (options.failSnapshot) throw new Error('snapshot failed');
      state.builds.push(input);
      const id = randomUUID(), applicationId = input.planningApplicationId ?? input.buildingWarrantApplicationId;
      const app = state.applications.find((row: any) => row.id === applicationId);
      const dataSnapshot = { ...snapshot(id, applicationId), site: { address: { addressLine1: state.currentAddress } },
        metadata: { ...snapshot(id, applicationId).metadata, portalDraftKey: app.preparationData.portalDraftKey }, documents: [...state.documents] };
      return { jobId: id, createdAt: new Date(), snapshot: { dataSnapshot, documentSnapshot: { documents: [...state.documents] },
        preflight: { status: options.preflight ?? 'READY' }, sourceType: 'PROJECT', title: 'Fresh details', snapshotHash: 'fresh', sourceUpdatedAt: new Date() } };
    } },
  };
  const { resetAutomationJob } = load('src/server/services/automation-job-reset.service.ts', modules);
  const input = { organisation: { id: 'org', name: 'Practice' }, actor: { id: 'user', name: 'Architect', email: 'test@example.test' }, applicationId: 'application', type,
    expectedJobId: options.noJob ? null : 'old', requestId: randomUUID() };
  return { tx, state: () => state, input, reset: (patch = {}) => resetAutomationJob({ ...input, ...patch }) };
}

for (const type of ['HOUSEHOLDER_PLANNING', 'BUILDING_WARRANT']) {
  for (const status of ['DRAFT', 'PREFLIGHT_REQUIRED', 'NEEDS_INPUT', 'READY', 'STALE', 'CLAIMED', 'IN_PROGRESS', 'NEEDS_REVIEW', 'AWAITING_PORTAL_REVIEW', 'COMPLETED', 'FAILED_FINAL', 'FAILED_RETRYABLE', 'CANCELLED']) {
    const test = harness(type, status);
    const before = structuredClone(test.state().jobs[0]);
    const job = await test.reset();
    assert.notEqual(job.id, 'old'); assert.equal(job.status, 'READY'); assert.equal(job.executionAuthorisedAt, null);
    assert.equal(job.dataSnapshot.site.address.addressLine1, '2 West Ferryfield');
    assert.deepEqual(job.documentSnapshot.documents, ['current.pdf']);
    assert.equal(job.error, null); assert.equal(job.resultData, null);
    assert.ok(job.dataSnapshot.metadata.portalDraftKey);
    assert.deepEqual(test.state().jobs[0].dataSnapshot, before.dataSnapshot);
    assert.deepEqual(test.state().jobs[0].resultData, before.resultData);
    if (['COMPLETED', 'FAILED_FINAL', 'FAILED_RETRYABLE', 'CANCELLED'].includes(status)) assert.equal(test.state().jobs[0].status, status);
    else assert.equal(test.state().jobs[0].status, 'CANCELLED');
    if (status === 'CLAIMED') assert.equal(test.state().agentJob, null, 'an unstarted cancelled claim releases immediately');
    if (['IN_PROGRESS', 'NEEDS_REVIEW', 'AWAITING_PORTAL_REVIEW'].includes(status)) {
      await assert.rejects(assertExecutionAvailable(test.tx, 'org'), /awaiting release/);
      test.state().events.push({ automationJobId: 'old', eventType: 'execution_released' });
      await assertExecutionAvailable(test.tx, 'org');
    }
  }
}
const twice = harness();
const [first, repeated] = await Promise.all([twice.reset(), twice.reset()]);
assert.equal(first.id, repeated.id); assert.equal(twice.state().builds.length, 1);
await assert.rejects(twice.reset({ requestId: randomUUID() }), /newer run/);
const later = await twice.reset({ expectedJobId: first.id, requestId: randomUUID() });
assert.notEqual(later.id, first.id); assert.notEqual(later.dataSnapshot.metadata.portalDraftKey, first.dataSnapshot.metadata.portalDraftKey);
for (const options of [{ failSnapshot: true }, { failCreate: true }]) {
  const test = harness('HOUSEHOLDER_PLANNING', 'IN_PROGRESS', options);
  const before = structuredClone(test.state());
  await assert.rejects(test.reset()); assert.deepEqual(test.state(), before, 'failed reset rolls back the old run and canonical details');
}
const foreign = harness();
await assert.rejects(foreign.reset({ organisation: { id: 'other', name: 'Other practice' } }), /not found/);
assert.equal(foreign.state().jobs.length, 1);
const scoped = harness();
const unrelated = structuredClone(scoped.state().jobs[0]);
unrelated.id = 'other-planning'; unrelated.dataSnapshot.metadata.jobId = unrelated.id;
unrelated.dataSnapshot.planning.recordId = 'other-application';
const warrant = structuredClone(unrelated);
warrant.id = 'other-warrant'; warrant.type = 'BUILDING_WARRANT';
warrant.dataSnapshot.metadata = { ...warrant.dataSnapshot.metadata, jobId: warrant.id, applicationType: warrant.type };
warrant.dataSnapshot.planning = null; warrant.dataSnapshot.buildingWarrant = { recordId: 'warrant-application' };
scoped.state().jobs.push(unrelated, warrant);
await scoped.reset();
assert.deepEqual(scoped.state().jobs.find((row: any) => row.id === unrelated.id), unrelated);
assert.deepEqual(scoped.state().jobs.find((row: any) => row.id === warrant.id), warrant);
for (const type of ['HOUSEHOLDER_PLANNING', 'BUILDING_WARRANT']) {
  const test = harness(type, 'COMPLETED', { applicationStatus: 'SUBMITTED' });
  const oldApplication = structuredClone(test.state().applications[0]);
  const job = await test.reset();
  assert.notEqual(automationJobApplicationId(job), oldApplication.id);
  assert.deepEqual(test.state().applications[0], oldApplication, 'submitted record and official references remain intact');
  await assert.rejects(test.reset({ requestId: randomUUID() }), /fresh reset/);
}
assert.equal((await harness('HOUSEHOLDER_PLANNING', 'FAILED_FINAL', { preflight: 'NEEDS_INPUT' }).reset()).status, 'NEEDS_INPUT');
assert.equal((await harness('BUILDING_WARRANT', 'FAILED_FINAL', { noJob: true }).reset()).status, 'READY');
const caps = { workflows: ['HOUSEHOLDER_PLANNING'], snapshotVersions: [2], callbackContractVersions: [1], progressContractVersions: [1] };
const resetJob = { type: enums.AutomationJobType.HOUSEHOLDER_PLANNING, payloadVersion: 2, dataSnapshot: { metadata: { portalDraftKey: randomUUID() } } };
assert.equal(agentSupportsJob({ capabilities: caps } as never, resetJob), false, 'older Agents cannot claim a reset they do not understand');
assert.equal(agentSupportsJob({ capabilities: { ...caps, resetContractVersions: [1] } } as never, resetJob), true);
assert.equal(agentSupportsJob({ capabilities: caps } as never, { ...resetJob, dataSnapshot: {} }), true, 'existing jobs remain compatible');
assert.ok(!fs.readFileSync('src/pages/api/sites/[id].ts', 'utf8').includes('resetAutomationJob'), 'saving a Site never resets either run automatically');
const calls: string[] = [];
const endpoint = load('src/pages/api/automation-jobs/reset.ts', {
  zod: { z }, '@/lib/server/origin-guard': { assertAllowedOrigin: () => calls.push('origin') },
  '@/lib/server/rate-limit': { assertRateLimit: () => calls.push('rate'), rateLimitPolicies: { mutation: {} } },
  '@/lib/utils/handlers': { parseBody, withErrorHandling }, '@/lib/utils/http': { jsonResponse },
  '@/server/permissions/authz': { requireOrganisation: async () => { calls.push('auth'); return { organisation: { id: 'org', name: 'Practice' }, user: { id: 'user', email: 'user@example.test' } }; } },
  '@/server/services/automation-job-reset.service': { resetAutomationJob: async (input: any) => { calls.push('reset'); assert.equal(input.organisation.id, 'org'); assert.equal(input.actor.id, 'user'); return { id: 'new' }; } },
});
const body = { type: 'HOUSEHOLDER_PLANNING', applicationId: 'planning', expectedJobId: 'old', requestId: randomUUID() };
const post = (value: unknown) => endpoint.POST({ request: new Request('https://example.test/api/automation-jobs/reset', { method: 'POST', body: JSON.stringify(value) }) });
assert.equal((await post(body)).status, 200);
assert.deepEqual(calls, ['origin', 'rate', 'auth', 'reset']);
for (const invalid of [{ ...body, requestId: 'wrong' }, { ...body, organisationId: 'other' }, { ...body, expectedJobId: undefined }]) {
  calls.length = 0;
  assert.equal((await post(invalid)).status, 400);
  assert.ok(!calls.includes('reset'));
}
console.log('Application reset: both workflows, all run states, atomic rollback, repeat requests, concurrent/stale requests, release barriers, current details, submission history and Agent compatibility passed.');
