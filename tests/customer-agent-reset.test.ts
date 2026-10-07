import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as enums from '@prisma/client';
import { HttpError, jsonResponse } from '../src/lib/utils/http';
import { withErrorHandling, parseBody } from '../src/lib/utils/handlers';
import * as credentials from '../src/server/auth/agent-credential';
import { agentEnrollmentExchangeSchema, agentHeartbeatSchema } from '../src/lib/validation/desktop-agent';
import * as execution from '../src/server/services/desktop-execution.service';
import { assertAgentConnectionResettable } from '../src/server/services/desktop-agent-reset.service';
import { revokeAgentInTransaction } from '../src/server/services/desktop-agent-revocation.service';
import { isHealthyAgent, agentSupportsJob, healthyAgentWhere } from '../src/server/services/desktop-agent.service';

const capabilities = { workflows: ['HOUSEHOLDER_PLANNING'], snapshotVersions: [2], callbackContractVersions: [1], progressContractVersions: [1] };
const installationId = '9c65df19-5a77-4e2c-a82f-30362b36773e';
let agent: any = { id: 'agent', organisationId: 'practice_a', installationId, enabled: true, revokedAt: null, credentialHash: 'old', lastSeenAt: new Date(), capabilities };
let job: any = { id: 'queued', organisationId: 'practice_a', claimedByAgentId: null, status: 'READY', released: false };
let issuedTokenRevoked = false;
let grantOrganisation = 'practice_a';
let grantUsed = false;
const tx: any = {
  $executeRaw: async () => {},
  automationJob: { findFirst: async ({ where }: any) => {
    if (where.status) return null; // heartbeat browser commands
    if (where.organisationId !== job.organisationId || where.claimedByAgentId !== job.claimedByAgentId) return null;
    return ['CLAIMED', 'IN_PROGRESS', 'NEEDS_REVIEW'].includes(job.status) || (job.status === 'AWAITING_PORTAL_REVIEW' && !job.released) ? job : null;
  } },
  agentRegistration: {
    findUnique: async () => agent,
    findFirst: async ({ where }: any) => Object.entries(where).every(([key, value]) => agent[key] === value) ? agent : null,
    update: async ({ data }: any) => { Object.assign(agent, data); return agent; },
    updateMany: async ({ data }: any) => { Object.assign(agent, data); return { count: 1 }; },
    create: async () => { throw new Error('must reuse the installation registration'); },
  },
  desktopAccessToken: { updateMany: async ({ where }: any) => { assert.equal(where.organisationId, 'practice_a'); assert.equal(where.automationJob.claimedByAgentId, 'agent'); issuedTokenRevoked = true; return { count: 1 }; } },
  agentEnrollmentToken: { findUnique: async () => ({ id: 'grant', organisationId: grantOrganisation, createdByUserId: 'architect' }), updateMany: async () => { if (grantUsed) return { count: 0 }; grantUsed = true; return { count: 1 }; } },
};
const database = { ...tx, $transaction: async (fn: any) => {
  const before = structuredClone({ agent, grantUsed, issuedTokenRevoked });
  try { return await fn(tx); } catch (error) { agent = before.agent; grantUsed = before.grantUsed; issuedTokenRevoked = before.issuedTokenRevoked; throw error; }
} };
const modules: any = {
  '@prisma/client': enums, '@/lib/db/prisma': { prisma: database },
  '@/lib/server/rate-limit': { assertRateLimit: () => {}, rateLimitPolicies: { desktop: {}, auth: {} } },
  '@/lib/utils/handlers': { withErrorHandling, parseBody }, '@/lib/utils/http': { HttpError, jsonResponse },
  '@/lib/validation/desktop-agent': { agentEnrollmentExchangeSchema, agentHeartbeatSchema },
  '@/server/auth/agent-credential': { ...credentials, requireAgentAuth: async () => { if (!agent.enabled || agent.revokedAt) throw new HttpError(401, 'invalid'); return structuredClone(agent); } },
  '@/server/services/desktop-agent-revocation.service': { revokeAgentInTransaction },
  '@/server/services/desktop-execution.service': execution,
  '@/server/services/desktop-agent-reset.service': { assertAgentConnectionResettable },
  '@/server/services/desktop-agent.service': { agentLeaseExpiry: () => new Date(), reconcileStaleAgentJobs: async () => {} },
};
function route(file: string, method: string) {
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; }, Date, console });
  return (body?: any) => exports[method]({ request: new Request('https://example.test', { method, ...(body ? { body: JSON.stringify(body) } : {}) }) });
}
const reset = route('src/pages/api/desktop/registration.ts', 'DELETE');
const enroll = route('src/pages/api/desktop/enrollment/exchange.ts', 'POST');
const heartbeat = route('src/pages/api/desktop/heartbeat.ts', 'POST');
const exchange = () => enroll({ organisationId: grantOrganisation, token: `ape_${'x'.repeat(48)}`, installationId, machineName: 'Practice PC', agentVersion: '4.1.0', capabilities });

for (const status of ['CLAIMED', 'IN_PROGRESS', 'NEEDS_REVIEW', 'AWAITING_PORTAL_REVIEW']) {
  job.status = status; job.claimedByAgentId = agent.id;
  assert.equal((await reset()).status, 409, status);
  assert.equal(agent.enabled, true); assert.equal(issuedTokenRevoked, false);
}
job.status = 'READY'; job.claimedByAgentId = null;
const queuedBefore = structuredClone(job);
grantOrganisation = 'practice_b';
assert.equal((await exchange()).status, 403, 'practice B cannot take practice A enrollment from installation ID');
assert.equal(agent.organisationId, 'practice_a'); assert.equal(agent.enabled, true);
grantOrganisation = 'practice_a';
assert.equal((await reset()).status, 200);
assert.equal(agent.enabled, false); assert.equal(issuedTokenRevoked, true); assert.deepEqual(job, queuedBefore);
assert.equal((await reset()).status, 401, 'invalid old credential cannot revoke anything else');
const enrolled = await exchange(); assert.equal(enrolled.status, 201);
assert.equal(agent.id, 'agent'); assert.equal(agent.installationId, installationId);
assert.notEqual(agent.credentialHash, 'old'); assert.equal(agent.lastSeenAt, null);
assert.equal(isHealthyAgent(agent), false, 'exchange alone is not an accepted heartbeat');
assert.equal((await heartbeat({ version: 1, agentVersion: '4.1.0', capabilities, state: 'READY', currentJobId: null, agentRunId: null })).status, 200);
assert.equal(isHealthyAgent(agent), true);
assert.equal(agentSupportsJob(agent, { type: enums.AutomationJobType.HOUSEHOLDER_PLANNING, payloadVersion: 2 }), true);
assert.equal(agentSupportsJob(agent, { type: enums.AutomationJobType.BUILDING_WARRANT, payloadVersion: 2 }), false);
assert.equal(agentSupportsJob(agent, { type: enums.AutomationJobType.HOUSEHOLDER_PLANNING, payloadVersion: 3 }), false);
assert.deepEqual(job, queuedBefore, 'reset and enrollment do not replace or cancel queued work');
assert.equal(healthyAgentWhere('practice_a').enabled, true);
for (const overrides of [{ enabled: false }, { revokedAt: new Date() }, { lastSeenAt: new Date(Date.now() - 91_000) }]) assert.equal(isHealthyAgent({ ...agent, ...overrides }), false);
console.log('Customer Agent reset, re-enrollment, heartbeat and health tests passed (isolated endpoints).');
