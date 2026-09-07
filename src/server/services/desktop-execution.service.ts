import { AutomationJobStatus, Prisma } from '@prisma/client';
import { HttpError } from '@/lib/utils/http';

// Every acquisition, release, start and revocation uses this same DB boundary.
export const lockOrganisationExecution = async (tx: Prisma.TransactionClient, organisationId: string) => {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`desktop-execution:${organisationId}`}))`);
};

export const assertExecutionAvailable = async (
  tx: Prisma.TransactionClient, organisationId: string, ownJobId?: string,
) => {
  const occupied = await tx.automationJob.findFirst({
    where: {
      organisationId,
      ...(ownJobId ? { id: { not: ownJobId } } : {}),
      OR: [
        { status: { in: [AutomationJobStatus.CLAIMED, AutomationJobStatus.IN_PROGRESS, AutomationJobStatus.NEEDS_REVIEW] } },
        {
          status: AutomationJobStatus.AWAITING_PORTAL_REVIEW,
          claimedByAgentId: { not: null },
          events: { none: { eventType: 'execution_released' } },
        },
      ],
    },
    select: { id: true },
  });
  if (occupied) throw new HttpError(409, 'Another application is running or awaiting release. Finish or review that attempt before starting another.');
};

export const assertRegisteredAgentActive = async (tx: Prisma.TransactionClient, organisationId: string, agentId: string, credentialHash?: string) => {
  const agent = await tx.agentRegistration.findFirst({ where: {
    id: agentId, organisationId, enabled: true, revokedAt: null,
    ...(credentialHash ? { credentialHash } : {}),
  } });
  if (!agent) throw new HttpError(401, 'This Architect Pro Agent has been revoked or is not registered.');
  return agent;
};

export const releaseAgentExecution = async (
  tx: Prisma.TransactionClient, organisationId: string, agentId: string, jobId: string, agentRunId: string,
) => {
  const job = await tx.automationJob.findFirst({
    where: { id: jobId, organisationId, claimedByAgentId: agentId, agentRunId },
    select: { id: true, status: true },
  });
  if (!job) {
    // An expired, unstarted claim may already have been safely requeued.
    // Acknowledge that no slot remains without releasing any newer owner.
    return Boolean(await tx.automationJob.findFirst({
      where: { id: jobId, organisationId, status: AutomationJobStatus.READY, claimedByAgentId: null, claimedDeviceId: null, agentRunId: null },
      select: { id: true },
    }));
  }
  const releasable: AutomationJobStatus[] = [
    AutomationJobStatus.AWAITING_PORTAL_REVIEW, AutomationJobStatus.COMPLETED,
    AutomationJobStatus.FAILED_RETRYABLE, AutomationJobStatus.FAILED_FINAL,
    AutomationJobStatus.FAILED, AutomationJobStatus.CANCELLED,
  ];
  if (!releasable.includes(job.status)) return false;
  await tx.automationJobEvent.upsert({
    where: { idempotencyKey: `execution-release:${organisationId}:${job.id}:${agentRunId}` },
    update: {},
    create: {
      organisationId, automationJobId: job.id, eventType: 'execution_released',
      idempotencyKey: `execution-release:${organisationId}:${job.id}:${agentRunId}`,
      payload: { agentId, agentRunId },
    },
  });
  await tx.agentRegistration.updateMany({
    where: { id: agentId, organisationId, currentJobId: job.id },
    data: { currentJobId: null, operatingState: 'READY' },
  });
  return true;
};
