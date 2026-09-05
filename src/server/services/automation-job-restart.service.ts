import {
  AutomationJobStatus,
  AutomationJobType,
  DeadlineStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { readAutomationFailureMetadata } from '@/lib/automation/failure-recovery';
import { HttpError } from '@/lib/utils/http';
import { buildFreshAutomationJob } from '@/server/services/automation-jobs.service';
import { resolveAutomationJobIdentity } from '@/server/services/desktop-automation-status.service';
import {
  agentSupportsJob,
  ensureWaitingForAgentAction,
  healthyAgentCutoff,
} from '@/server/services/desktop-agent.service';

export const restartFailedAutomationJob = async (input: {
  organisation: { id: string; name: string };
  actor: { id: string; name: string | null; email: string };
  oldJobId: string;
}) => {
  const oldJob = await prisma.automationJob.findFirst({
    where: { id: input.oldJobId, organisationId: input.organisation.id },
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
    organisationId: input.organisation.id,
    organisationName: input.organisation.name,
    projectId: oldJob.projectId,
    type: oldJob.type,
    createdBy: {
      id: input.actor.id,
      name: input.actor.name ?? input.actor.email,
      email: input.actor.email,
    },
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
    const retryLockKey = `automation-retry:${input.organisation.id}:${oldJob.projectId}:${oldJob.type}`;
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtext(${retryLockKey}))
    `);
    const existingActive = await transaction.automationJob.findFirst({
      where: {
        organisationId: input.organisation.id,
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
        organisationId: input.organisation.id,
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
        createdById: input.actor.id,
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
        organisationId: input.organisation.id,
        sourceKey: `automation-job:${oldJob.id}:retry`,
        status: { notIn: [DeadlineStatus.COMPLETED, DeadlineStatus.CANCELLED] },
      },
      data: { status: DeadlineStatus.CANCELLED },
    });
    return created;
  });

  const agents = await prisma.agentRegistration.findMany({
    where: {
      organisationId: input.organisation.id,
      enabled: true,
      revokedAt: null,
      lastSeenAt: { gt: healthyAgentCutoff(authorisedAt) },
    },
  });
  const compatibleAgentOnline = agents.some((agent) => agentSupportsJob(agent, newJob));
  if (!compatibleAgentOnline) {
    await ensureWaitingForAgentAction(
      prisma,
      newJob,
      agents.length ? 'Architect Pro Agent update required' : 'Waiting for Architect Pro Agent',
    );
  }

  return { newJob, compatibleAgentOnline };
};
