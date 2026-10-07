import { recordAuthorisedSnapshot } from '@/server/services/automation-state-model.service';
import {
  AutomationJobStatus,
  AutomationJobType,
  DeadlineStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { readAutomationFailureMetadata } from '@/lib/automation/failure-recovery';
import { HttpError } from '@/lib/utils/http';
import { automationJobSnapshotV2Schema } from '@/lib/validation/automation-job';
import { assertDesktopTokenActive } from '@/server/auth/desktop-token';
import { lockOrganisationExecution } from '@/server/services/desktop-execution.service';
import { buildFreshAutomationJob } from '@/server/services/automation-jobs.service';
import { resolveAutomationJobIdentity } from '@/server/services/desktop-automation-status.service';
import {
  agentSupportsJob,
  ensureWaitingForAgentAction,
  healthyAgentCutoff,
} from '@/server/services/desktop-agent.service';

type RestartInput = {
  organisation: { id: string; name: string };
  actor: { id: string; name: string | null; email: string };
  oldJobId: string;
  desktopAccess?: { id: string; organisationId: string };
  correctedPostcode?: string;
};

const retryJobSelect = {
  id: true, organisationId: true, projectId: true, type: true, payloadVersion: true,
  status: true, executionAuthorisedAt: true, progressStage: true, progressStageState: true,
  progressPercent: true, etaSeconds: true, progressMessage: true, resultSummary: true,
  error: true, agentHeartbeatAt: true, resultData: true, lastCheckpoint: true,
} satisfies Prisma.AutomationJobSelect;

// Shared by web retries and Desktop corrections. No canonical writes or snapshot
// reads escape this transaction. The event preserves one successor per old job.
export const restartFailedAutomationJobInTransaction = async (transaction: Prisma.TransactionClient, input: RestartInput) => {
  await lockOrganisationExecution(transaction, input.organisation.id);
  if (input.desktopAccess) {
    if (input.desktopAccess.organisationId !== input.organisation.id) throw new HttpError(404, 'Automation job not found.');
    await assertDesktopTokenActive(transaction, input.desktopAccess);
  }
  const oldJob = await transaction.automationJob.findFirst({
    where: { id: input.oldJobId, organisationId: input.organisation.id, ...(input.desktopAccess ? { claimedDeviceId: input.desktopAccess.id } : {}) },
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
  const idempotencyKey = `automation-restart:${input.organisation.id}:${oldJob.id}`;
  const prior = await transaction.automationJobEvent.findUnique({ where: { idempotencyKey } });
  if (prior) {
    const payload = prior.payload as { newJobId?: string; postcode?: string | null };
    if (input.correctedPostcode && payload.postcode !== input.correctedPostcode) {
      throw new HttpError(409, 'This attempt already has a different retry. Review the current application in Architect Pro.');
    }
    const successor = await transaction.automationJob.findFirst({
      where: { id: payload.newJobId ?? '', organisationId: input.organisation.id, projectId: oldJob.projectId },
      select: retryJobSelect,
    });
    if (!successor) throw new HttpError(409, 'The recorded retry is no longer available. Review the application in Architect Pro.');
    return successor;
  }
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

  const retryLockKey = `automation-retry:${input.organisation.id}:${oldJob.projectId}:${oldJob.type}`;
  await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${retryLockKey}))`);
  const existingActive = await transaction.automationJob.findFirst({
    where: {
      organisationId: input.organisation.id, projectId: oldJob.projectId, type: oldJob.type,
      id: { not: oldJob.id },
      status: { in: [AutomationJobStatus.READY, AutomationJobStatus.CLAIMED, AutomationJobStatus.IN_PROGRESS, AutomationJobStatus.NEEDS_REVIEW, AutomationJobStatus.AWAITING_PORTAL_REVIEW] },
    }, select: { id: true },
  });
  if (existingActive) throw new HttpError(409, 'This application already has an active automation attempt.');

  if (input.correctedPostcode) {
    if (!input.desktopAccess || !['ADDRESS_RESOLUTION_FAILED', 'SITE_DATA_INVALID'].includes(recovery.category ?? '')) {
      throw new HttpError(409, 'This failure does not authorise a postcode correction.');
    }
    const snapshot = automationJobSnapshotV2Schema.safeParse(oldJob.dataSnapshot);
    if (!snapshot.success || !snapshot.data.site.id || !snapshot.data.site.updatedAt) {
      throw new HttpError(409, 'This attempt does not contain an exact versioned Site to correct safely.');
    }
    const updated = await transaction.site.updateMany({
      where: {
        id: snapshot.data.site.id, organisationId: input.organisation.id,
        updatedAt: new Date(snapshot.data.site.updatedAt),
        projects: { some: { id: oldJob.projectId, organisationId: input.organisation.id } },
      }, data: { postcode: input.correctedPostcode },
    });
    if (!updated.count) throw new HttpError(409, 'The project Site changed since this attempt. Review the current address in Architect Pro.');
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
  }, transaction);
  const { jobId: newJobId, snapshot } = freshJob;
  if (snapshot.preflight.status !== 'READY') {
    throw new HttpError(409, 'Application details changed and need review before the automation can be retried.');
  }
  const authorisedAt = new Date();

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
      select: retryJobSelect,
    });
    await recordAuthorisedSnapshot(transaction, { organisationId: input.organisation.id, jobId: created.id });
    await transaction.deadline.updateMany({
      where: {
        organisationId: input.organisation.id,
        sourceKey: `automation-job:${oldJob.id}:retry`,
        status: { notIn: [DeadlineStatus.COMPLETED, DeadlineStatus.CANCELLED] },
      },
      data: { status: DeadlineStatus.CANCELLED },
    });
    await transaction.automationJobEvent.create({ data: {
      organisationId: input.organisation.id, automationJobId: oldJob.id,
      idempotencyKey, eventType: 'fresh_retry_created',
      payload: { newJobId: created.id, postcode: input.correctedPostcode ?? null },
    } });
    return created;
};

export const restartFailedAutomationJob = async (input: RestartInput) => {
  const commit = async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await prisma.$transaction(
          (transaction) => restartFailedAutomationJobInTransaction(transaction, input),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      }
    }
  };
  const newJob = await commit();

  // Optional availability presentation cannot turn a committed retry into an
  // apparent failure. A repeated request returns the same recorded successor.
  let compatibleAgentOnline = false;
  try {
  const agents = await prisma.agentRegistration.findMany({
    where: {
      organisationId: input.organisation.id,
      enabled: true,
      revokedAt: null,
      lastSeenAt: { gt: healthyAgentCutoff(new Date()) },
    },
  });
  compatibleAgentOnline = agents.some((agent) => agentSupportsJob(agent, newJob));
  if (!compatibleAgentOnline && newJob.status === AutomationJobStatus.READY) {
    await ensureWaitingForAgentAction(
      prisma,
      newJob,
      agents.length ? 'Architect Pro Agent update required' : 'Waiting for Architect Pro Agent',
    );
  }
  } catch {
    console.warn('Fresh retry committed; Agent availability could not be projected.', { jobId: newJob.id });
  }

  return { newJob, compatibleAgentOnline };
};
