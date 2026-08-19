export const prerender = false;

import { z } from 'zod';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireAgentAuth } from '@/server/auth/agent-credential';

const acknowledgementSchema = z.object({
  agentRunId: z.string().uuid(),
  requestedAt: z.string().datetime({ offset: true }),
}).strict();

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-agent:reveal-browser-ack');
  const agent = await requireAgentAuth(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Automation job id is required.');
  const body = await parseBody(context.request, acknowledgementSchema);
  const job = await prisma.automationJob.findFirst({
    where: { id, organisationId: agent.organisationId, claimedByAgentId: agent.id, agentRunId: body.agentRunId },
    select: { browserRevealRequestedAt: true },
  });
  if (!job?.browserRevealRequestedAt || job.browserRevealRequestedAt.toISOString() !== body.requestedAt) {
    throw new HttpError(409, 'This browser reveal request is no longer current.');
  }
  await prisma.automationJob.updateMany({
    where: { id, organisationId: agent.organisationId, claimedByAgentId: agent.id, agentRunId: body.agentRunId },
    data: { browserRevealAcknowledgedAt: job.browserRevealRequestedAt },
  });
  return jsonResponse(200, { ok: true });
}, context);
