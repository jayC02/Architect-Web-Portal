export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireAgentAuth } from '@/server/auth/agent-credential';
import { revokeAgentInTransaction } from '@/server/services/desktop-agent-revocation.service';

export const DELETE: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-agent:self-revoke');
  const agent = await requireAgentAuth(context);
  await prisma.$transaction((tx) => revokeAgentInTransaction(tx, { agentId: agent.id, organisationId: agent.organisationId }));
  return jsonResponse(200, { ok: true });
}, context);
