import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as prismaTypes from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { HttpError, jsonResponse } from '../src/lib/utils/http';
import { withErrorHandling, parseBody } from '../src/lib/utils/handlers';
import { desktopJobStatusSchema } from '../src/lib/validation/desktop-handoff';
import { assertAutomationJobTransition } from '../src/server/services/automation-lifecycle.service';

const filename = 'src/pages/api/desktop/automation-jobs/[id]/index.ts';
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function harness(status = 'CLAIMED', expired = false) {
  const job = { id: 'job_start_123', status, projectId: 'project_a', claimedByAgentId: 'agent_a', leaseExpiresAt: new Date(Date.now() + (expired ? -1000 : 60000)) };
  const events = new Set<string>();
  let writes = 0;
  const database: any = {
    automationJob: { findFirst: async () => job, updateMany: async ({ data }: any) => { Object.assign(job, data); writes++; return { count: 1 }; } },
    $executeRaw: async (sql: any) => { const key = sql.values.find((value: string) => value === callback.callbackId); if (key) events.add(key); },
    $queryRaw: async (sql: any) => sql.values.some((value: string) => events.has(value)) ? [{ id: 'event' }] : [],
    $transaction: async (fn: any) => fn(database),
  };
  const modules: any = {
    'node:crypto': { randomUUID }, '@prisma/client': prismaTypes,
    '@/lib/db/prisma': { prisma: database },
    '@/lib/server/rate-limit': { assertRateLimit: () => {}, rateLimitPolicies: { desktop: {} } },
    '@/lib/validation/desktop-handoff': { desktopJobStatusSchema },
    '@/lib/utils/handlers': { withErrorHandling, parseBody }, '@/lib/utils/http': { HttpError, jsonResponse },
    '@/server/auth/desktop-token': { requireDesktopAuth: async () => ({ id: 'token', organisationId: 'org_a' }), assertDesktopJobAccess: () => {}, assertDesktopTokenActive: async () => {} },
    '@/server/services/desktop-execution.service': { lockOrganisationExecution: async () => {} },
    '@/server/services/automation-lifecycle.service': { assertAutomationJobTransition },
    '@/server/services/prepared-application-review.service': {},
  };
  const exports: any = {};
  vm.runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; }, Date, console });
  const callback = { version: 1, jobId: job.id, callbackId: randomUUID(), occurredAt: new Date().toISOString(), eventType: 'started', status: 'IN_PROGRESS' };
  return { job, callback, writes: () => writes, post: (body = callback) => exports.PATCH({ params: { id: job.id }, request: new Request('https://example.com', { method: 'PATCH', body: JSON.stringify(body) }) }) };
}
const live = harness();
assert.equal((await live.post()).status, 200);
assert.equal(live.job.status, 'IN_PROGRESS');
assert.equal((await live.post()).status, 200, 'lost response retry of the same start is acknowledged');
assert.equal(live.writes(), 1);
assert.equal((await live.post({ ...live.callback, callbackId: randomUUID() })).status, 409, 'another worker cannot start the same running job');
for (const status of ['READY', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'COMPLETED', 'CANCELLED', 'NEEDS_REVIEW', 'AWAITING_PORTAL_REVIEW']) {
  const stale = harness(status);
  assert.equal((await stale.post()).status, 409, status);
  assert.equal(stale.writes(), 0);
}
assert.equal((await harness('CLAIMED', true).post()).status, 409);
const checkpoint = harness();
assert.equal((await checkpoint.post({ ...checkpoint.callback, eventType: 'checkpoint' })).status, 409);
console.log('Desktop start acknowledgement endpoint tests passed.');
