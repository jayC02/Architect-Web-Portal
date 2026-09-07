import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertExecutionAvailable, lockOrganisationExecution, releaseAgentExecution, assertRegisteredAgentActive } from '../src/server/services/desktop-execution.service';

// Simulated transactions serialize at the exact helper used by all claim paths.
const jobs: any[] = [];
let tail = Promise.resolve();
async function claim(organisationId: string, id: string) {
  let unlock!: () => void;
  const predecessor = tail;
  tail = new Promise<void>((resolve) => { unlock = resolve; });
  const tx: any = {
    $executeRaw: async () => predecessor,
    automationJob: { findFirst: async ({ where }: any) => {
      assert.equal(where.OR[0].status.in.includes('NEEDS_REVIEW'), true);
      return jobs.find((job) => job.organisationId === where.organisationId && job.status === 'CLAIMED') ?? null;
    } },
  };
  try {
    await lockOrganisationExecution(tx, organisationId);
    await assertExecutionAvailable(tx, organisationId);
    jobs.push({ organisationId, id, status: 'CLAIMED' });
  } finally { unlock(); }
}
const concurrent = await Promise.allSettled([claim('org_a', 'job_a'), claim('org_a', 'job_b')]);
assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
assert.equal(jobs.length, 1);
await claim('org_b', 'job_c');
assert.equal(jobs.length, 2);

let releases = 0;
const tx: any = {
  automationJob: { findFirst: async ({ where }: any) => where.agentRunId === 'correct' ? { id: 'job_a', status: 'AWAITING_PORTAL_REVIEW' } : null },
  automationJobEvent: { upsert: async () => { releases++; } },
  agentRegistration: { updateMany: async () => ({ count: 1 }) },
};
assert.equal(await releaseAgentExecution(tx, 'org_a', 'agent_a', 'job_a', 'wrong'), false);
assert.equal(releases, 0);
assert.equal(await releaseAgentExecution(tx, 'org_a', 'agent_a', 'job_a', 'correct'), true);
assert.equal(releases, 1);
tx.automationJob.findFirst = async ({ where }: any) => where.status === 'READY' && where.claimedByAgentId === null ? { id: 'job_a' } : null;
assert.equal(await releaseAgentExecution(tx, 'org_a', 'agent_a', 'job_a', 'expired-run'), true, 'requeued unstarted claim does not strand local release');
assert.equal(releases, 1, 'acknowledging an expired claim does not mutate another run');
const rotated: any = { agentRegistration: { findFirst: async ({ where }: any) => where.credentialHash === 'new' ? { id: 'agent_a' } : null } };
await assert.rejects(assertRegisteredAgentActive(rotated, 'org_a', 'agent_a', 'old'), 'a pre-authenticated request cannot survive revoke and re-enrollment');
await assertRegisteredAgentActive(rotated, 'org_a', 'agent_a', 'new');

for (const path of ['src/pages/api/desktop/queue/[id]/claim.ts', 'src/pages/api/desktop/automation-jobs/[id]/claim.ts', 'src/pages/api/desktop/handoff/exchange.ts']) {
  const source = fs.readFileSync(path, 'utf8');
  assert.match(source, /await lockOrganisationExecution/);
  assert.match(source, /await assertExecutionAvailable/);
  assert.ok(source.indexOf('await lockOrganisationExecution') < source.indexOf('const claimed ='));
}
console.log('Desktop execution exclusivity tests passed (simulated transactions).');
