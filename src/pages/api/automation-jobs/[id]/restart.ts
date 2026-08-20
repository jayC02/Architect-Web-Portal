export const prerender = false;

import { randomUUID } from 'node:crypto';
import {
  AutomationJobStatus,
  AutomationJobType,
  DeadlineStatus,
  type Prisma,
} from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { buildAutomationJobSnapshot } from '@/server/services/automation-jobs.service';
import {
  resolveAutomationJobIdentity,
} from '@/server/services/desktop-automation-status.service';
import { agentSupportsJob, ensureWaitingForAgentAction, healthyAgentCutoff } from '@/server/services/desktop-agent.service';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'automation-jobs:restart');
  const { organisation, user } = await requireOrganisation(context);
  const oldJobId = context.params.id;
  if (!oldJobId) throw new HttpError(400, 'Automation job id is required.');

  const oldJob = await prisma.automationJob.findFirst({
    where: { id: oldJobId, organisationId: organisation.id },
    select: {
      id: true,
      organisationId: true,
      projectId: true,
      type: true,
      status: true,
      dataSnapshot: true,
      completedAt: true,
    },
  });
  if (!oldJob) throw new HttpError(404, 'Automation job not found.');
  if (oldJob.status !== AutomationJobStatus.FAILED_RETRYABLE || oldJob.completedAt) {
    throw new HttpError(409, 'This automation attempt is not confirmed safe to retry. Review the issue before continuing.');
  }

  let identity;
  try {
    identity = resolveAutomationJobIdentity(oldJob);
  } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : 'This application cannot be retried safely.');
  }

  const newJobId = randomUUID();
  const snapshot = await buildAutomationJobSnapshot({
    jobId: newJobId,
    organisationId: organisation.id,
    organisationName: organisation.name,
    projectId: oldJob.projectId,
    type: oldJob.type,
    createdBy: { id: user.id, name: user.name, email: user.email },
    planningApplicationId: oldJob.type === AutomationJobType.BUILDING_WARRANT
      ? undefined
      : identity.applicationId,
    buildingWarrantApplicationId: oldJob.type === AutomationJobType.BUILDING_WARRANT
      ? identity.applicationId
      : undefined,
  });
  if (snapshot.preflight.status !== 'READY') {
    throw new HttpError(409, 'Application details changed and need review before the automation can be retried.');
  }
  const authorisedAt = new Date();

  const newJob = await prisma.$transaction(async (transaction) => {
    const consumed = await transaction.automationJob.updateMany({
      where: {
        id: oldJob.id,
        organisationId: organisation.id,
        status: AutomationJobStatus.FAILED_RETRYABLE,
        completedAt: null,
      },
      data: { completedAt: authorisedAt },
    });
    if (!consumed.count) {
      throw new HttpError(409, 'This automation attempt has already been retried or changed.');
    }

    const created = await transaction.automationJob.create({
      data: {
        id: newJobId,
        organisationId: organisation.id,
        projectId: oldJob.projectId,
        type: oldJob.type,
        status: AutomationJobStatus.READY,
        sourceType: snapshot.sourceType,
        title: snapshot.title,
        payloadVersion: 2,
        snapshotHash: snapshot.snapshotHash,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
        preparedAt: new Date(),
        executionAuthorisedAt: authorisedAt,
        dataSnapshot: snapshot.dataSnapshot as Prisma.InputJsonValue,
        documentSnapshot: snapshot.documentSnapshot as Prisma.InputJsonValue,
        createdById: user.id,
      },
      select: {
        id: true, organisationId: true, projectId: true, type: true, payloadVersion: true,
        status: true, executionAuthorisedAt: true, progressStage: true, progressStageState: true,
        progressPercent: true, etaSeconds: true, progressMessage: true, resultSummary: true,
        error: true, agentHeartbeatAt: true,
      },
    });
    await transaction.deadline.updateMany({
      where: {
        organisationId: organisation.id,
        sourceKey: `automation-job:${oldJob.id}:retry`,
        status: { notIn: [DeadlineStatus.COMPLETED, DeadlineStatus.CANCELLED] },
      },
      data: { status: DeadlineStatus.CANCELLED },
    });
    return created;
  });

  const agents = await prisma.agentRegistration.findMany({
    where: {
      organisationId: organisation.id,
      enabled: true,
      revokedAt: null,
      lastSeenAt: { gt: healthyAgentCutoff(authorisedAt) },
    },
  });
  const compatible = agents.some((agent) => agentSupportsJob(agent, newJob));
  if (!compatible) {
    await ensureWaitingForAgentAction(
      prisma,
      newJob,
      agents.length ? 'Architect Pro Agent update required' : 'Waiting for Architect Pro Agent',
    );
  }

  return jsonResponse(201, {
    job: { ...newJob, stale: false },
    compatibleAgentOnline: compatible,
  });
}, context);
