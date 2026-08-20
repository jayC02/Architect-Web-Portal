export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { AGENT_HEALTHY_MS } from '@/server/services/desktop-agent.service';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'desktop-agent:reveal-browser');
  const { organisation } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Automation job id is required.');
  const now = new Date();
  const job = await prisma.automationJob.findFirst({
    where: { id, organisationId: organisation.id },
    select: {
      status: true,
      claimedByAgentId: true,
      agentRunId: true,
      claimedByAgent: {
        select: { enabled: true, revokedAt: true, lastSeenAt: true },
      },
    },
  });
  const revealableStatuses: AutomationJobStatus[] = [
    AutomationJobStatus.COMPLETED,
    AutomationJobStatus.AWAITING_PORTAL_REVIEW,
  ];
  if (!job || !revealableStatuses.includes(job.status)) {
    throw new HttpError(409, 'This application is not available to open from the Desktop Agent.');
  }
  if (!job.claimedByAgentId || !job.agentRunId) {
    throw new HttpError(409, 'This application is not linked to the Desktop Agent that prepared it.');
  }
  const agentOnline = Boolean(
    job.claimedByAgent?.enabled
    && !job.claimedByAgent.revokedAt
    && job.claimedByAgent.lastSeenAt
    && now.getTime() - job.claimedByAgent.lastSeenAt.getTime() <= AGENT_HEALTHY_MS,
  );
  if (!agentOnline) {
    throw new HttpError(409, "Desktop Agent isn't connected. Open Architect Pro Agent to view this application.");
  }
  const requested = await prisma.automationJob.updateMany({
    where: {
      id,
      organisationId: organisation.id,
      status: job.status,
      claimedByAgentId: job.claimedByAgentId,
      agentRunId: job.agentRunId,
    },
    data: { browserRevealRequestedAt: now },
  });
  if (!requested.count) throw new HttpError(409, 'The application changed before the browser request could be queued. Try again.');
  return jsonResponse(202, { ok: true, queued: true, requestedAt: now.toISOString() });
}, context);
