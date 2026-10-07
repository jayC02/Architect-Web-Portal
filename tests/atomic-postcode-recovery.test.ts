import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as prismaTypes from '@prisma/client';
import { recordAuthorisedSnapshot } from '../src/server/services/automation-state-model.service';
import { HttpError } from '../src/lib/utils/http';
import { readAutomationFailureMetadata } from '../src/lib/automation/failure-recovery';

// Execute the production transaction service with a rollback-capable in-memory
// boundary. This tests orchestration, not PostgreSQL's locking implementation.
const file = 'src/server/services/automation-job-restart.service.ts';
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function harness(options: { active?: boolean; stale?: boolean; preflight?: boolean; insertFails?: boolean; eventFails?: boolean; revoked?: boolean; category?: string } = {}) {
  const original = { id: 'old', organisationId: 'org_a', projectId: 'project_a', type: 'HOUSEHOLDER_PLANNING', claimedDeviceId: 'token_a', status: 'FAILED_RETRYABLE', resultData: { retrySafe: true, failureCategory: options.category ?? 'ADDRESS_RESOLUTION_FAILED' }, dataSnapshot: { site: { id: 'site_a', updatedAt: '2026-09-01T10:00:00.000Z', postcode: 'G41 5BZ' } } };
  let state: any = { old: structuredClone(original), postcode: 'G41 5BZ', siteVersion: options.stale ? 'newer' : original.dataSnapshot.site.updatedAt, jobs: [], journal: [], event: null, deadline: 'OPEN' };
  let tail = Promise.resolve();
  let builds = 0;
  const tx: any = {
    automationJob: {
      findFirst: async ({ where }: any) => {
        if (where.organisationId !== 'org_a') return null;
        if (where.id === 'old') return where.claimedDeviceId && where.claimedDeviceId !== 'token_a' ? null : state.old;
        if (typeof where.id === 'string') return state.jobs.find((job: any) => job.id === where.id) ?? null;
        return options.active ? { id: 'other-active' } : state.jobs.find((job: any) => where.status.in.includes(job.status)) ?? null;
      },
      create: async ({ data }: any) => { if (options.insertFails) throw new Error('insert failed'); state.jobs.push(structuredClone(data)); return data; },
    },
    site: { updateMany: async ({ where, data }: any) => {
      assert.equal(where.id, 'site_a'); assert.equal(where.organisationId, 'org_a');
      assert.equal(where.projects.some.id, 'project_a');
      if (where.updatedAt.toISOString() !== state.siteVersion) return { count: 0 };
      state.postcode = data.postcode; state.siteVersion = 'changed'; return { count: 1 };
    } },
    automationJobEvent: {
      upsert: async ({where, create}: any) => {
        const existing = state.journal.find((entry: any) => entry.idempotencyKey === where.idempotencyKey);
        if (existing) return existing;
        state.journal.push(structuredClone(create)); return create;
      }, findUnique: async () => state.event, create: async ({ data }: any) => { if (options.eventFails) throw new Error('event failed'); state.event = structuredClone(data); } },
    deadline: { updateMany: async () => { state.deadline = 'CANCELLED'; } },
    $executeRaw: async () => {},
  };
  const database = {
    $transaction: async (fn: any, transactionOptions: any) => {
      assert.equal(transactionOptions.isolationLevel, 'Serializable');
      let release!: () => void;
      const previous = tail; tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const before = structuredClone(state);
      try { return await fn(tx); } catch (error) { state = before; throw error; } finally { release(); }
    },
    agentRegistration: { findMany: async () => [] },
  };
  const modules: any = {
    '@/server/services/automation-state-model.service': { recordAuthorisedSnapshot },
    '@prisma/client': prismaTypes, '@/lib/db/prisma': { prisma: database }, '@/lib/utils/http': { HttpError },
    '@/lib/automation/failure-recovery': { readAutomationFailureMetadata },
    '@/lib/validation/automation-job': { automationJobSnapshotV2Schema: { safeParse: (data: any) => ({ success: true, data }) } },
    '@/server/auth/desktop-token': { assertDesktopTokenActive: async (passed: any) => { assert.equal(passed, tx); if (options.revoked) throw new HttpError(401, 'revoked'); } },
    '@/server/services/desktop-execution.service': { lockOrganisationExecution: async (passed: any) => assert.equal(passed, tx) },
    '@/server/services/desktop-automation-status.service': { resolveAutomationJobIdentity: () => ({ applicationId: 'planning_a' }) },
    '@/server/services/desktop-agent.service': { agentSupportsJob: () => false, ensureWaitingForAgentAction: async () => {}, healthyAgentCutoff: () => new Date() },
    '@/server/services/automation-jobs.service': { buildFreshAutomationJob: async (input: any, passed: any) => {
      assert.equal(passed, tx, 'fresh snapshot reads through the same transaction');
      assert.equal(input.planningApplicationId, 'planning_a'); builds++;
      return { jobId: `fresh_${builds}`, createdAt: new Date(), snapshot: { preflight: { status: options.preflight ? 'NEEDS_INPUT' : 'READY' }, dataSnapshot: { postcode: state.postcode }, documentSnapshot: { current: true }, sourceType: 'PROJECT' } };
    } },
  };
  const exports: any = {};
  vm.runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; }, Date, console });
  const input = { organisation: { id: 'org_a', name: 'Practice' }, actor: { id: 'user_a', name: 'Architect', email: 'test@example.com' }, oldJobId: 'old', desktopAccess: { id: 'token_a', organisationId: 'org_a' }, correctedPostcode: 'G41 5AA' };
  return { state: () => state, original, input, run: (overrides = {}) => exports.restartFailedAutomationJob({ ...input, ...overrides }) };
}
for (const options of [{ active: true }, { stale: true }, { preflight: true }, { insertFails: true }, { eventFails: true }, { revoked: true }, { category: 'DOCUMENT_UPLOAD_FAILED' }]) {
  const test = harness(options);
  const before = structuredClone(test.state());
  await assert.rejects(test.run());
  assert.deepEqual(test.state(), before, `no partial commit: ${JSON.stringify(options)}`);
}
const success = harness();
const [first, second] = await Promise.all([success.run(), success.run()]);
assert.equal(first.newJob.id, second.newJob.id);
assert.equal(success.state().jobs.length, 1);
assert.equal(success.state().postcode, 'G41 5AA');
assert.equal(first.newJob.dataSnapshot.postcode, 'G41 5AA');
assert.equal(success.state().deadline, 'CANCELLED');
assert.deepEqual(success.state().old, success.original, 'old snapshot/result untouched');
success.state().jobs[0].status = 'COMPLETED';
assert.equal((await success.run()).newJob.id, first.newJob.id, 'lost response retry never creates another successor, even after completion');
await assert.rejects(success.run({ correctedPostcode: 'G42 6BB' }));
assert.equal(success.state().postcode, 'G41 5AA');
const manualWins = harness();
await manualWins.run({ correctedPostcode: undefined, desktopAccess: undefined });
await assert.rejects(manualWins.run());
assert.equal(manualWins.state().postcode, 'G41 5BZ');
for (const desktopAccess of [{ id: 'other', organisationId: 'org_a' }, { id: 'token_a', organisationId: 'org_b' }]) {
  const scope = harness(); await assert.rejects(scope.run({ desktopAccess })); assert.equal(scope.state().jobs.length, 0);
}
console.log('Atomic postcode recovery tests passed (rollback-capable simulated transactions).');
