import assert from 'node:assert/strict';
import { removeWaitingAutomationJob } from '../src/server/services/automation-queue.service';

function harness(status = 'READY', options: { eventFails?: boolean; claimWins?: boolean } = {}) {
  let state = { job: { id: 'job', organisationId: 'org', status, executionAuthorisedAt: new Date('2026-10-07T10:00:00Z'),
    claimedByAgentId: null, claimedDeviceId: null }, events: [] as any[], actionResolved: false };
  const tx: any = {
    $executeRaw: async () => {},
    automationJob: {
      findFirst: async ({ where }: any) => where.organisationId === state.job.organisationId && where.id === state.job.id ? structuredClone(state.job) : null,
      updateMany: async ({ where, data }: any) => {
        assert.equal(where.organisationId, 'org'); assert.equal(where.status, 'READY');
        assert.equal(where.claimedByAgentId, null); assert.equal(where.claimedDeviceId, null);
        if (options.claimWins) return { count: 0 };
        state.job = { ...state.job, ...data }; return { count: 1 };
      },
    },
    actionItem: { updateMany: async ({ where }: any) => { assert.equal(where.organisationId, 'org'); state.actionResolved = true; } },
    automationJobEvent: { create: async ({ data }: any) => {
      if (options.eventFails) throw new Error('event failed');
      state.events.push(data);
    } },
  };
  const database: any = { $transaction: async (fn: any) => {
    const original = structuredClone(state);
    try { return await fn(tx); } catch (error) { state = original; throw error; }
  } };
  const input = { organisationId: 'org', jobId: 'job', userId: 'architect', database };
  return { run: (overrides = {}) => removeWaitingAutomationJob({ ...input, ...overrides }), state: () => state };
}
const ready = harness(); await ready.run();
assert.equal(ready.state().job.status, 'READY', 'prepared job is retained');
assert.equal(ready.state().job.executionAuthorisedAt, null, 'Agent can no longer claim the job');
assert.equal(ready.state().actionResolved, true, 'waiting-agent action is removed');
assert.equal(ready.state().events[0].eventType, 'queue_removed');
await ready.run(); assert.equal(ready.state().events.length, 1, 'repeated removal is harmless');
for (const status of ['CLAIMED', 'IN_PROGRESS', 'NEEDS_REVIEW', 'AWAITING_PORTAL_REVIEW', 'COMPLETED', 'CANCELLED']) {
  const active = harness(status); await assert.rejects(active.run(), /already started/);
  assert.equal(active.state().job.status, status);
  assert.ok(active.state().job.executionAuthorisedAt);
}
const foreign = harness(); await assert.rejects(foreign.run({ organisationId: 'foreign' }), /not found/);
assert.ok(foreign.state().job.executionAuthorisedAt);
const missing = harness(); await assert.rejects(missing.run({ jobId: 'missing' }), /not found/);
const racing = harness('READY', { claimWins: true }); await assert.rejects(racing.run(), /has changed/);
assert.equal(racing.state().actionResolved, false);
const failed = harness('READY', { eventFails: true }); await assert.rejects(failed.run(), /event failed/);
assert.ok(failed.state().job.executionAuthorisedAt, 'transaction failure restores execution permission');
assert.equal(failed.state().actionResolved, false);
console.log('Queue withdrawal: retained applications, idempotency, tenant isolation, claim races and rollback passed');
