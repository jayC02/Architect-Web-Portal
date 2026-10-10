import assert from 'node:assert/strict';
import { leaseIsCurrent, processingRetryDelay } from '../src/lib/document-processing';
import { prisma } from '../src/lib/db/prisma';
import { fencedProcessingWrite } from '../src/server/services/document-processing.service';
const now = new Date();
const job: any = { id: 'job', state: 'RUNNING', leaseOwner: 'worker-1', leaseGeneration: 1, leaseExpiresAt: new Date(now.getTime() + 10_000) };
assert.equal(leaseIsCurrent(job, 'worker-1', 1, now), true);
assert.equal(leaseIsCurrent(job, 'worker-2', 2, now), false);
assert.equal(leaseIsCurrent({ ...job, leaseExpiresAt: now }, 'worker-1', 1, now), false);
assert.deepEqual([1, 2, 3, 4, 5].map(processingRetryDelay), [15000, 30000, 60000, 120000, 240000]);
const transaction = prisma.$transaction;
let writes = 0;
let completions = 0;
let current = { ...job };
(prisma as any).$transaction = async (run: any) => run({ $queryRaw: async () => [current], documentProcessingJob: { update: async () => { completions++; } } });
try {
  assert.equal(await fencedProcessingWrite(job, async () => { writes++; }), true);
  current = { ...job, leaseOwner: 'worker-2', leaseGeneration: 2 };
  assert.equal(await fencedProcessingWrite(job, async () => { writes++; }), false);
  current = { ...job, leaseExpiresAt: new Date(0) };
  assert.equal(await fencedProcessingWrite(job, async () => { writes++; }), false);
  assert.equal(writes, 1); assert.equal(completions, 1);
} finally { prisma.$transaction = transaction; }
console.log('Workflow processing tests passed: ownership, generation, expiry fencing and retry delays.');
