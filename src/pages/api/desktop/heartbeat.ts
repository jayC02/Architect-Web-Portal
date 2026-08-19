export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { agentHeartbeatSchema } from '@/lib/validation/desktop-agent';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireAgentAuth } from '@/server/auth/agent-credential';
import { agentLeaseExpiry, reconcileStaleAgentJobs } from '@/server/services/desktop-agent.service';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-agent:heartbeat');
  const agent = await requireAgentAuth(context);
  const body = await parseBody(context.request, agentHeartbeatSchema);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.agentRegistration.updateMany({
      where: { id: agent.id, enabled: true, revokedAt: null },
      data: {
        lastSeenAt: now,
        operatingState: body.state,
        currentJobId: body.currentJobId ?? null,
        agentVersion: body.agentVersion,
        capabilities: body.capabilities,
      },
    });
    if (body.currentJobId && body.agentRunId) {
      await tx.automationJob.updateMany({
        where: {
          id: body.currentJobId,
          organisationId: agent.organisationId,
          claimedByAgentId: agent.id,
          agentRunId: body.agentRunId,
          status: { in: [AutomationJobStatus.CLAIMED, AutomationJobStatus.IN_PROGRESS] },
        },
        data: { agentHeartbeatAt: now, leaseExpiresAt: agentLeaseExpiry(now) },
      });
    }
  });
  await reconcileStaleAgentJobs({ organisationId: agent.organisationId, now });
  return jsonResponse(200, { ok: true, serverTime: now.toISOString(), heartbeatAfterSeconds: 30 });
}, context);

