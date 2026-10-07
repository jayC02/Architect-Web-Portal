export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireAgentAuth } from '@/server/auth/agent-credential';
import { revokeAgentInTransaction } from '@/server/services/desktop-agent-revocation.service';
import { lockOrganisationExecution, assertRegisteredAgentActive } from '@/server/services/desktop-execution.service';
import { assertAgentConnectionResettable } from '@/server/services/desktop-agent-reset.service';

export const DELETE: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-agent:self-revoke');
  const agent = await requireAgentAuth(context);
  await prisma.$transaction(async (tx) => {
    await lockOrganisationExecution(tx, agent.organisationId);
    await assertRegisteredAgentActive(tx, agent.organisationId, agent.id, agent.credentialHash);
    await assertAgentConnectionResettable(tx, agent.organisationId, agent.id);
    await revokeAgentInTransaction(tx, { agentId: agent.id, organisationId: agent.organisationId });
  });
  return jsonResponse(200, { ok: true });
}, context);
