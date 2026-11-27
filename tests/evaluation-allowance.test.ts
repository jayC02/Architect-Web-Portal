import assert from 'node:assert/strict';
import {
  assertEvaluationAllowance,
  billableKeyFor,
  DEFAULT_EVALUATION_APPLICATION_LIMIT,
  evaluationApplicationLimit,
} from '../src/server/billing/usage';

// Jobs without a resolvable application are keyed by their own id, which keeps
// these fixtures independent of the snapshot format.
const job = (id: string) => ({ id, type: 'BUILDING_WARRANT', projectId: 'project', dataSnapshot: null });
const keyOf = (id: string) => billableKeyFor(job(id), null);

const fakeDb = (input: { status: string | null; used: string[]; inFlight?: string[] }) => ({
  organisationSubscription: {
    findUnique: async () => (input.status ? { status: input.status } : null),
  },
  applicationUsage: {
    findMany: async () => input.used.map((id) => ({ billableKey: keyOf(id) })),
  },
  automationJob: {
    findMany: async ({ where }: { where: { id: { not: string } } }) =>
      (input.inFlight ?? []).filter((id) => id !== where.id.not).map(job),
  },
}) as never;

const organisationId = 'org';
const rejectsWithLimit = (promise: Promise<unknown>) =>
  assert.rejects(promise, (error: { status?: number; message?: string; details?: { code?: string } }) => {
    assert.equal(error.status, 402);
    assert.match(String(error.message), /evaluation includes/);
    return true;
  });

delete process.env.TRIAL_APPLICATION_LIMIT;
assert.equal(evaluationApplicationLimit(), DEFAULT_EVALUATION_APPLICATION_LIMIT);

// Paid and complimentary workspaces are never limited here.
for (const status of ['ACTIVE', 'COMPLIMENTARY', 'PAST_DUE', null]) {
  const result = await assertEvaluationAllowance(fakeDb({ status, used: ['a', 'b', 'c', 'd', 'e', 'f'] }), { organisationId, job: job('new') });
  assert.equal(result.limited, false, `${status} should not be limited`);
}

// Under the limit: allowed.
await assertEvaluationAllowance(fakeDb({ status: 'TRIALING', used: ['a', 'b', 'c', 'd'] }), { organisationId, job: job('new') });

// Applications approved but not finished count too.
await rejectsWithLimit(assertEvaluationAllowance(
  fakeDb({ status: 'TRIALING', used: ['a', 'b', 'c', 'd'], inFlight: ['queued'] }),
  { organisationId, job: job('new') },
));

// Re-running an application that already counted is free, even at the limit.
await assertEvaluationAllowance(fakeDb({ status: 'TRIALING', used: ['a', 'b', 'c', 'd', 'e'] }), { organisationId, job: job('c') });

// An in-flight job for the same application isn't counted twice.
await assertEvaluationAllowance(
  fakeDb({ status: 'TRIALING', used: ['a', 'b', 'c'], inFlight: ['d'] }),
  { organisationId, job: job('new') },
);

// At the limit with nothing in flight: refused.
await rejectsWithLimit(assertEvaluationAllowance(
  fakeDb({ status: 'TRIALING', used: ['a', 'b', 'c', 'd', 'e'] }),
  { organisationId, job: job('new') },
));

// The limit can be changed with TRIAL_APPLICATION_LIMIT.
process.env.TRIAL_APPLICATION_LIMIT = '2';
assert.equal(evaluationApplicationLimit(), 2);
await rejectsWithLimit(assertEvaluationAllowance(fakeDb({ status: 'TRIALING', used: ['a', 'b'] }), { organisationId, job: job('new') }));
process.env.TRIAL_APPLICATION_LIMIT = 'not a number';
assert.equal(evaluationApplicationLimit(), DEFAULT_EVALUATION_APPLICATION_LIMIT);
delete process.env.TRIAL_APPLICATION_LIMIT;

console.log('PASS evaluation allowance: paid workspaces unlimited, in-flight jobs counted, re-runs free, limit configurable.');
