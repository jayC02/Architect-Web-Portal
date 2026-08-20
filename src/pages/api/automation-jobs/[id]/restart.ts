export const prerender = false;

import {
  AutomationJobStatus,
  AutomationJobType,
  DeadlineStatus,
  Prisma,
} from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { readAutomationFailureMetadata } from '@/lib/automation/failure-recovery';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { buildFreshAutomationJob } from '@/server/services/automation-jobs.service';
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
      resultData: true,
      progressStage: true,
    },
  });
  if (!oldJob) throw new HttpError(404, 'Automation job not found.');
  const recovery = readAutomationFailureMetadata(oldJob.resultData, oldJob.status, oldJob.progressStage);
  if (oldJob.status !== AutomationJobStatus.FAILED_RETRYABLE || !recovery.retrySafe) {
    throw new HttpError(409, 'This automation attempt is not confirmed safe to retry. Review the issue before continuing.');
  }

  let identity;
  try {
    identity = resolveAutomationJobIdentity(oldJob);
  } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : 'This application cannot be retried safely.');
  }

  const freshJob = await buildFreshAutomationJob({
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
  const { jobId: newJobId, snapshot } = freshJob;
  if (snapshot.preflight.status !== 'READY') {
    throw new HttpError(409, 'Application details changed and need review before the automation can be retried.');
  }
  const authorisedAt = new Date();

  const newJob = await prisma.$transaction(async (transaction) => {
    const retryLockKey = `automation-retry:${organisation.id}:${oldJob.projectId}:${oldJob.type}`;
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtext(${retryLockKey}))
    `);
    const existingActive = await transaction.automationJob.findFirst({
      where: {
        organisationId: organisation.id,
        projectId: oldJob.projectId,
        type: oldJob.type,
        id: { not: oldJob.id },
        completedAt: null,
        status: { in: [
          AutomationJobStatus.READY,
          AutomationJobStatus.CLAIMED,
          AutomationJobStatus.IN_PROGRESS,
          AutomationJobStatus.AWAITING_PORTAL_REVIEW,
        ] },
      },
      select: { id: true },
    });
    if (existingActive) {
      throw new HttpError(409, 'This application already has an active automation attempt.');
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
        createdAt: freshJob.createdAt,
      },
      select: {
        id: true, organisationId: true, projectId: true, type: true, payloadVersion: true,
        status: true, executionAuthorisedAt: true, progressStage: true, progressStageState: true,
        progressPercent: true, etaSeconds: true, progressMessage: true, resultSummary: true,
        error: true, agentHeartbeatAt: true,
        resultData: true, lastCheckpoint: true,
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
