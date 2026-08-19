export const prerender = false;

import { ActionItemKind, ActionItemPriority, ActionItemStatus, AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { desktopProgressSchema } from '@/lib/validation/desktop-agent';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { assertDesktopJobAccess, requireDesktopAuth } from '@/server/auth/desktop-token';
import { agentLeaseExpiry, heartbeatStateForProgress } from '@/server/services/desktop-agent.service';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-agent:progress');
  const access = await requireDesktopAuth(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Automation job id is required.');
  assertDesktopJobAccess(access, id);
  const body = await parseBody(context.request, desktopProgressSchema);
  if (body.jobId !== id) throw new HttpError(400, 'Progress job id does not match the route.');
  const now = new Date();
  const isFee = body.status === 'USER_ACTION_REQUIRED' && body.progress.stage === 'fee';
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.automationJob.updateMany({
      where: {
        id,
        organisationId: access.organisationId,
        agentRunId: body.agentRunId,
        lastProgressSequence: { lt: body.sequence },
        status: { in: [AutomationJobStatus.CLAIMED, AutomationJobStatus.IN_PROGRESS, AutomationJobStatus.AWAITING_PORTAL_REVIEW] },
      },
      data: {
        status: isFee ? AutomationJobStatus.AWAITING_PORTAL_REVIEW : AutomationJobStatus.IN_PROGRESS,
        progressStage: body.progress.stage,
        progressStageState: body.progress.stageState,
        progressPercent: body.progress.percent,
        etaSeconds: body.status === 'USER_ACTION_REQUIRED' ? null : body.progress.etaSeconds,
        progressMessage: body.progress.message,
        progressUpdatedAt: new Date(body.occurredAt),
        lastProgressSequence: body.sequence,
        agentHeartbeatAt: now,
        leaseExpiresAt: agentLeaseExpiry(now),
      },
    });
    if (!updated.count) return { duplicate: true };
    const job = await tx.automationJob.findUnique({ where: { id }, select: { claimedByAgentId: true, projectId: true } });
    if (job?.claimedByAgentId) {
      await tx.agentRegistration.updateMany({
        where: { id: job.claimedByAgentId, organisationId: access.organisationId, enabled: true, revokedAt: null },
        data: { operatingState: heartbeatStateForProgress(body.progress.stage), currentJobId: id, lastSeenAt: now },
      });
    }
    if (isFee && job) {
      const dedupeKey = `automation:${id}:fee`;
      await tx.actionItem.upsert({
        where: { organisationId_dedupeKey: { organisationId: access.organisationId, dedupeKey } },
        update: { status: ActionItemStatus.OPEN, resolvedAt: null },
        create: {
          organisationId: access.organisationId,
          projectId: job.projectId,
          kind: ActionItemKind.DESKTOP_AUTOMATION,
          title: 'Complete the fee in the browser',
          summary: 'Automated preparation is complete. Review and complete the fee in the same owned Chrome window.',
          actionUrl: `/projects/${job.projectId}`,
          priority: ActionItemPriority.HIGH,
          dedupeKey,
        },
      });
    }
    return { duplicate: false };
  });
  return jsonResponse(200, { ok: true, ...result });
}, context);

