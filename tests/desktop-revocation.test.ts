import assert from 'node:assert/strict';
import { assertDesktopTokenActive } from '../src/server/auth/desktop-token';
import { revokeAgentInTransaction } from '../src/server/services/desktop-agent-revocation.service';

const agent: any = { id: 'agent_a', organisationId: 'org_a', enrolledByUserId: 'owner', enabled: true, revokedAt: null };
const token: any = { id: 'token_a', organisationId: 'org_a', automationJobId: 'job_a', revokedAt: null,
  expiresAt: new Date(Date.now() + 86400000),
  automationJob: { organisationId: 'org_a', claimedDeviceId: 'token_a', claimedByAgentId: 'agent_a' } };
const tx: any = {
  $executeRaw: async () => 1,
  agentRegistration: {
    findFirst: async ({ where }: any) => where.id === agent.id && where.organisationId === agent.organisationId
      && (!where.enrolledByUserId || where.enrolledByUserId === agent.enrolledByUserId)
      && (where.enabled === undefined || agent.enabled) && (where.revokedAt === undefined || !agent.revokedAt) ? agent : null,
    update: async ({ data }: any) => Object.assign(agent, data),
  },
  desktopAccessToken: {
    findFirst: async ({ where }: any) => where.id === token.id && where.organisationId === token.organisationId
      && !token.revokedAt && token.expiresAt > where.expiresAt.gt ? token : null,
    updateMany: async ({ where, data }: any) => {
      assert.equal(where.organisationId, 'org_a');
      assert.equal(where.automationJob.claimedByAgentId, 'agent_a');
      Object.assign(token, data); return { count: 1 };
    },
  },
};
const access = { id: token.id, organisationId: token.organisationId };
await assertDesktopTokenActive(tx, access);
await assert.rejects(revokeAgentInTransaction(tx, { organisationId: 'org_a', agentId: 'agent_a', enrolledByUserId: 'other' }), /not found/);
assert.equal(agent.enabled, true);
await revokeAgentInTransaction(tx, { organisationId: 'org_a', agentId: 'agent_a' });
await assert.rejects(assertDesktopTokenActive(tx, access), /expired or been revoked/);
agent.enabled = true; agent.revokedAt = null;
await assert.rejects(assertDesktopTokenActive(tx, access), /expired or been revoked/, 'reenrollment cannot revive old token');
token.revokedAt = null; agent.enabled = false;
await assert.rejects(assertDesktopTokenActive(tx, access), /revoked or is not registered/, 'authoritative Agent check also protects unswept tokens');
agent.enabled = true;
token.automationJob.claimedDeviceId = 'new-claim';
await assert.rejects(assertDesktopTokenActive(tx, access), /no longer owns/);
token.automationJobId = null; token.automationJob = null;
await assertDesktopTokenActive(tx, access); // Legacy non-Agent credentials remain valid.
await assert.rejects(assertDesktopTokenActive(tx, { ...access, organisationId: 'org_b' }), /expired or been revoked/);
console.log('Desktop revocation tests passed.');
