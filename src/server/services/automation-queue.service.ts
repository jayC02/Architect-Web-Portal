import { AutomationJobStatus, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';
import { lockOrganisationExecution } from '@/server/services/desktop-execution.service';
import { resolveAgentAction, waitingAgentActionKey } from '@/server/services/desktop-agent.service';

/** Withdraw execution permission, retaining the prepared application for a later run. */
export const removeWaitingAutomationJob = async (input: {
  organisationId: string; jobId: string; userId: string; database?: PrismaClient;
}) => (input.database ?? prisma).$transaction(async tx => {
  // Claims take this same lock: removing a job can never race a successful claim.
  await lockOrganisationExecution(tx, input.organisationId);
  const job = await tx.automationJob.findFirst({
    where: { id: input.jobId, organisationId: input.organisationId },
    select: { id: true, status: true, executionAuthorisedAt: true },
  });
  if (!job) throw new HttpError(404, 'Automation job not found.');
  if (job.status !== AutomationJobStatus.READY) {
    throw new HttpError(409, 'This job has already started. Stop it in the Agent before removing it.');
  }
  if (!job.executionAuthorisedAt) return;
  const removed = await tx.automationJob.updateMany({
    where: { id: job.id, organisationId: input.organisationId, status: AutomationJobStatus.READY,
      executionAuthorisedAt: job.executionAuthorisedAt, claimedByAgentId: null, claimedDeviceId: null },
    data: { executionAuthorisedAt: null },
  });
  if (!removed.count) throw new HttpError(409, 'This job has changed. Refresh the queue and try again.');
  await resolveAgentAction(tx, input.organisationId, waitingAgentActionKey(job.id));
  await tx.automationJobEvent.create({
    data: { organisationId: input.organisationId, automationJobId: job.id, eventType: 'queue_removed',
      idempotencyKey: `queue-removed:${input.organisationId}:${job.id}:${job.executionAuthorisedAt.toISOString()}`,
      payload: { userId: input.userId, previousAuthorisedAt: job.executionAuthorisedAt.toISOString() } },
  });
});
