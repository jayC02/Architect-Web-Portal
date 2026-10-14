import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { AutomationJobStatus } from '@prisma/client';
import { agentHeartbeatSchema } from '../src/lib/validation/desktop-agent';
import { withErrorHandling, parseBody } from '../src/lib/utils/handlers';
import { HttpError, jsonResponse } from '../src/lib/utils/http';

const requestedAt = new Date('2026-10-14T13:55:35.574Z');
const job = { id: 'prepared-job', status: 'AWAITING_PORTAL_REVIEW', type: 'HOUSEHOLDER_PLANNING',
  organisationId: 'org', claimedByAgentId: 'agent', agentRunId: 'original-run',
  browserRevealRequestedAt: requestedAt, browserRevealAcknowledgedAt: null };
let released = true;
let acknowledged = false;
let actor = 'agent';
let lastWhere: any;
const database: any = {
  agentRegistration: { updateMany: async () => ({ count: 1 }) },
  automationJob: { findFirst: async ({ where }: any) => {
    lastWhere = where;
    assert.equal(where.organisationId, 'org');
    assert.equal(where.claimedByAgentId, actor);
    assert.ok(where.OR.some((filter: any) => filter.status === 'AWAITING_PORTAL_REVIEW'
      && filter.events.some.eventType === 'execution_released'));
    if (!released || actor !== 'agent') return null;
    return { ...job, browserRevealAcknowledgedAt: acknowledged ? requestedAt : null };
  } },
  $transaction: async (fn: any) => fn(database),
};
const modules: Record<string, any> = {
  '@prisma/client': { AutomationJobStatus }, '@/lib/db/prisma': { prisma: database },
  '@/lib/server/rate-limit': { assertRateLimit: () => {}, rateLimitPolicies: { desktop: {} } },
  '@/lib/validation/desktop-agent': { agentHeartbeatSchema },
  '@/lib/utils/handlers': { withErrorHandling, parseBody }, '@/lib/utils/http': { HttpError, jsonResponse },
  '@/server/auth/agent-credential': { requireAgentAuth: async () => ({ id: actor, organisationId: 'org', credentialHash: 'hash' }) },
  '@/server/services/desktop-agent.service': { reconcileStaleAgentJobs: async () => {}, agentLeaseExpiry: () => new Date() },
  '@/server/services/desktop-execution.service': { lockOrganisationExecution: async () => {}, assertRegisteredAgentActive: async () => {}, releaseAgentExecution: async () => true },
};
const endpoint = (file: string, name: 'GET' | 'POST') => {
  const exports: any = {};
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, Date, require: (name: string) => {
    assert.ok(name in modules, name); return modules[name];
  } });
  return exports[name];
};
const heartbeat = endpoint('src/pages/api/desktop/heartbeat.ts', 'POST');
const view = endpoint('src/pages/api/desktop/automation-jobs/[id]/view.ts', 'GET');
const pulse = () => heartbeat({ request: new Request('https://example.test/api/desktop/heartbeat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    version: 1, state: 'READY', agentVersion: '4.2.1',
    capabilities: { workflows: ['HOUSEHOLDER_PLANNING', 'BUILDING_WARRANT'], snapshotVersions: [2], callbackContractVersions: [1], progressContractVersions: [1] },
  }),
}) });
const first = await pulse();
assert.equal(first.status, 200);
const payload = await first.json();
assert.deepEqual(payload.commands, [{ type: 'OPEN_APPLICATION', jobId: job.id,
  applicationType: job.type, agentRunId: job.agentRunId, requestedAt: requestedAt.toISOString() }],
  'an idle Agent can open its released review application without reacquiring execution');
assert.equal((await view({ params: { id: job.id } })).status, 200);
assert.equal(lastWhere.id, job.id, 'view requests retain exact job identity');
acknowledged = true;
assert.deepEqual((await (await pulse()).json()).commands, [], 'acknowledged requests are not replayed');
released = false; acknowledged = false;
assert.deepEqual((await (await pulse()).json()).commands, [], 'unreleased handoffs remain scoped to the active run');
assert.equal((await view({ params: { id: job.id } })).status, 404);
released = true; actor = 'another-agent';
assert.equal((await view({ params: { id: job.id } })).status, 404, 'another Agent cannot open this retained application');
console.log('Released review command delivery, acknowledgement and Agent isolation tests passed.');
