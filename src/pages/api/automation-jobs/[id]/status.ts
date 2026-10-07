export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { AGENT_HEALTHY_MS, agentSupportsJob, healthyAgentWhere } from '@/server/services/desktop-agent.service';

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  const { organisation } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Automation job id is required.');
  const job = await prisma.automationJob.findFirst({
    where: { id, organisationId: organisation.id },
    select: {
      id: true, type: true, payloadVersion: true, status: true, executionAuthorisedAt: true, progressStage: true, progressStageState: true, progressPercent: true,
      etaSeconds: true, progressMessage: true, progressUpdatedAt: true, agentHeartbeatAt: true,
      resultSummary: true, error: true,
      resultData: true, lastCheckpoint: true,
    },
  });
  if (!job) throw new HttpError(404, 'Automation job not found.');
  const stale = Boolean(job.agentHeartbeatAt && Date.now() - job.agentHeartbeatAt.getTime() > AGENT_HEALTHY_MS);
  const agents = job.status === 'READY'
    ? await prisma.agentRegistration.findMany({ where: healthyAgentWhere(organisation.id), select: { capabilities: true } })
    : [];
  return jsonResponse(200, { job: { ...job, stale }, compatibleAgentOnline: agents.some((agent) => agentSupportsJob(agent, job)) });
}, context);
