export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireAgentAuth } from '@/server/auth/agent-credential';

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-agent:view-application');
  const agent = await requireAgentAuth(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Automation job id is required.');
  const job = await prisma.automationJob.findFirst({
    where: {
      id,
      organisationId: agent.organisationId,
      claimedByAgentId: agent.id,
      status: AutomationJobStatus.COMPLETED,
    },
    select: {
      id: true,
      projectId: true,
      type: true,
      status: true,
      sourceType: true,
      title: true,
      payloadVersion: true,
      dataSnapshot: true,
      documentSnapshot: true,
      agentRunId: true,
    },
  });
  if (!job) {
    throw new HttpError(404, 'The prepared application could not be found for this Agent.');
  }
  return jsonResponse(200, { job });
}, context);
