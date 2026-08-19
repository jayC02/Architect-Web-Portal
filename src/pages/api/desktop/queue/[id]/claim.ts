export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { agentClaimSchema } from '@/lib/validation/desktop-agent';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireAgentAuth } from '@/server/auth/agent-credential';
import {
  createDesktopTokenValue,
  desktopJobTokenExpiry,
  desktopTokenHash,
  desktopTokenPrefix,
} from '@/server/auth/desktop-token';
import {
  agentLeaseExpiry,
  agentSupportsJob,
  resolveAgentAction,
  waitingAgentActionKey,
} from '@/server/services/desktop-agent.service';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-agent:claim');
  const agent = await requireAgentAuth(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Automation job id is required.');
  const body = await parseBody(context.request, agentClaimSchema);
  const now = new Date();
  const jobToken = createDesktopTokenValue();
  const expiresAt = desktopJobTokenExpiry();
  const result = await prisma.$transaction(async (tx) => {
    const job = await tx.automationJob.findFirst({
      where: { id, organisationId: agent.organisationId, status: AutomationJobStatus.READY, executionAuthorisedAt: { not: null } },
      select: { id: true, organisationId: true, projectId: true, type: true, payloadVersion: true, createdById: true },
    });
    if (!job) throw new HttpError(409, 'This automation job is no longer available.');
    if (!agentSupportsJob(agent, job)) throw new HttpError(409, 'This Agent is not compatible with the prepared application.');
    const access = await tx.desktopAccessToken.create({
      data: {
        organisationId: job.organisationId,
        userId: agent.enrolledByUserId,
        automationJobId: job.id,
        name: `${agent.machineName} automatic run`,
        tokenHash: desktopTokenHash(jobToken),
        tokenPrefix: desktopTokenPrefix(jobToken),
        expiresAt,
      },
    });
    const claimed = await tx.automationJob.updateMany({
      where: { id: job.id, organisationId: agent.organisationId, status: AutomationJobStatus.READY, executionAuthorisedAt: { not: null }, claimedByAgentId: null },
      data: {
        status: AutomationJobStatus.CLAIMED,
        claimedByAgentId: agent.id,
        claimedByUserId: agent.enrolledByUserId,
        claimedDeviceId: access.id,
        claimedAt: now,
        agentRunId: body.agentRunId,
        agentHeartbeatAt: now,
        leaseExpiresAt: agentLeaseExpiry(now),
        progressStage: 'claimed',
        progressStageState: 'pending',
        progressPercent: 0,
        progressMessage: 'Architect Pro Agent claimed the application',
        progressUpdatedAt: now,
        lastProgressSequence: 0,
      },
    });
    if (!claimed.count) throw new HttpError(409, 'Another Architect Pro Agent claimed this application first.');
    await tx.agentRegistration.update({ where: { id: agent.id }, data: { currentJobId: job.id, operatingState: 'RUNNING', lastSeenAt: now } });
    await resolveAgentAction(tx as never, job.organisationId, waitingAgentActionKey(job.id), now);
    return job;
  });
  return jsonResponse(200, {
    jobId: result.id,
    agentRunId: body.agentRunId,
    jobAccessToken: jobToken,
    jobAccessExpiresAt: expiresAt.toISOString(),
  });
}, context);

