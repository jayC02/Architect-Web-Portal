export const prerender = false;

import { AgentOperatingState } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireAgentAuth } from '@/server/auth/agent-credential';

export const DELETE: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-agent:self-revoke');
  const agent = await requireAgentAuth(context);
  await prisma.agentRegistration.updateMany({
    where: { id: agent.id, enabled: true, revokedAt: null },
    data: { enabled: false, revokedAt: new Date(), operatingState: AgentOperatingState.DISCONNECTED },
  });
  return jsonResponse(200, { ok: true });
}, context);
