export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'desktop-agent:reveal-browser');
  const { organisation } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Automation job id is required.');
  const now = new Date();
  const requested = await prisma.automationJob.updateMany({
    where: {
      id,
      organisationId: organisation.id,
      status: AutomationJobStatus.AWAITING_PORTAL_REVIEW,
      claimedByAgentId: { not: null },
      agentRunId: { not: null },
    },
    data: { browserRevealRequestedAt: now },
  });
  if (!requested.count) throw new HttpError(409, 'The existing fee browser is not available for this application. Open the Architect Pro Agent for help.');
  return jsonResponse(202, { ok: true, queued: true, requestedAt: now.toISOString() });
}, context);
