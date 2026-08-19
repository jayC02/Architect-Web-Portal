export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { agentSupportsJob, ensureWaitingForAgentAction, healthyAgentCutoff } from '@/server/services/desktop-agent.service';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'desktop-agent:run');
  const { organisation } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Automation job id is required.');
  const job = await prisma.automationJob.findFirst({
    where: { id, organisationId: organisation.id, status: AutomationJobStatus.READY },
    select: { id: true, organisationId: true, projectId: true, type: true, payloadVersion: true },
  });
  if (!job) throw new HttpError(409, 'This application is not ready to run.');
  const authorisedAt = new Date();
  const authorised = await prisma.automationJob.updateMany({
    where: { id, organisationId: organisation.id, status: AutomationJobStatus.READY },
    data: { executionAuthorisedAt: authorisedAt },
  });
  if (!authorised.count) throw new HttpError(409, 'This application changed before it could be authorised.');
  const agents = await prisma.agentRegistration.findMany({
    where: { organisationId: organisation.id, enabled: true, revokedAt: null, lastSeenAt: { gt: healthyAgentCutoff(authorisedAt) } },
  });
  const compatible = agents.some((agent) => agentSupportsJob(agent, job));
  if (!compatible) await ensureWaitingForAgentAction(prisma, job, agents.length ? 'Architect Pro Agent update required' : 'Waiting for Architect Pro Agent');
  return jsonResponse(200, { ok: true, queued: true, compatibleAgentOnline: compatible });
}, context);

