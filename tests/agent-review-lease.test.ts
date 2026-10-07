import assert from 'node:assert/strict';
import { releaseExpiredReviewExecutions } from '../src/server/services/desktop-agent.service';

const now = new Date('2026-10-07T12:00:00Z');
let current = true;
let released = 0;
let cleared = 0;
let locked = false;
const job = { id: 'review-job', organisationId: 'org-a', claimedByAgentId: 'agent-a', agentRunId: 'run-a' };
const tx: any = {
  $executeRaw: async () => { locked = true; },
  automationJob: {
    findFirst: async ({where}: any) => {
      assert(locked);
      assert.equal(where.organisationId, 'org-a');
      assert.equal(where.claimedByAgentId, 'agent-a');
      assert.equal(where.agentRunId, 'run-a');
      if (where.leaseExpiresAt) {
        assert.equal(where.status, 'AWAITING_PORTAL_REVIEW');
        assert.equal(where.leaseExpiresAt.lte, now);
        assert.equal(where.events.none.eventType, 'execution_released');
        return current ? {id: job.id} : null;
      }
      return {...job, status:'AWAITING_PORTAL_REVIEW'};
    },
    updateMany: async () => { throw new Error('Review application state must not change'); },
  },
  automationJobEvent: { upsert: async ({create}: any) => {
    assert.equal(create.eventType, 'execution_released');
    assert.equal(create.payload.agentRunId, 'run-a');
    released++;
  } },
  agentRegistration: { updateMany: async ({where,data}: any) => {
    assert.equal(where.currentJobId, job.id);
    assert.equal(where.organisationId, job.organisationId);
    assert.equal(data.currentJobId, null);
    cleared++;
  } },
};
const database: any = {
  automationJob: { findMany: async ({where}: any) => {
    assert.equal(where.organisationId, 'org-a');
    assert.equal(where.status, 'AWAITING_PORTAL_REVIEW');
    assert.equal(where.leaseExpiresAt.lte, now);
    assert.equal(where.events.none.eventType, 'execution_released');
    return [job];
  } },
  $transaction: async (callback: any) => { locked=false; return callback(tx); },
};
assert.equal(await releaseExpiredReviewExecutions({organisationId:'org-a',now,database}), 1);
assert.equal(released, 1); assert.equal(cleared, 1);
current=false;
assert.equal(await releaseExpiredReviewExecutions({organisationId:'org-a',now,database}), 0);
assert.equal(released, 1, 'a lease renewed before lock acquisition keeps its execution slot');
assert.equal(cleared, 1);
console.log('Expired review lease tests passed; live leases and review state preserved.');
