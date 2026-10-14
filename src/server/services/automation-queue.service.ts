import { AutomationJobStatus, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';
import { lockOrganisationExecution, releaseAgentExecution, assertRegisteredAgentActive } from '@/server/services/desktop-execution.service';
import { connectionLostActionKey, resolveAgentAction, waitingAgentActionKey } from '@/server/services/desktop-agent.service';
import { recordAutomationOwnership } from '@/server/services/automation-state-model.service';

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

/** Cancel this attempt, preserving its application and fencing late starts/results. */
export const cancelAutomationJob = async (input: {
  organisationId: string; jobId: string; userId?: string;
  agent?: { id: string; runId: string; credentialHash: string }; database?: PrismaClient;
}) => (input.database ?? prisma).$transaction(async tx => {
  await lockOrganisationExecution(tx, input.organisationId);
  if (input.agent) await assertRegisteredAgentActive(tx, input.organisationId, input.agent.id, input.agent.credentialHash);
  const job = await tx.automationJob.findFirst({
    where: { id: input.jobId, organisationId: input.organisationId },
    select: { id: true, status: true, claimedByAgentId: true, agentRunId: true },
  });
  if (!job) throw new HttpError(404, 'Automation job not found.');
  if (input.agent && (job.claimedByAgentId !== input.agent.id || job.agentRunId !== input.agent.runId)) {
    throw new HttpError(409, 'This application is no longer assigned to this Agent.');
  }
  if (job.status === AutomationJobStatus.CANCELLED) {
    const released = await tx.automationJobEvent.findFirst({
      where: { organisationId: input.organisationId, automationJobId: job.id, eventType: 'execution_released' },
      select: { id: true },
    });
    return { pending: Boolean(job.claimedByAgentId && !released) };
  }
  const cancellable: AutomationJobStatus[] = [AutomationJobStatus.READY, AutomationJobStatus.CLAIMED,
    AutomationJobStatus.IN_PROGRESS, AutomationJobStatus.NEEDS_REVIEW];
  if (!cancellable.includes(job.status)) throw new HttpError(409, 'This attempt has already finished. Refresh the application.');
  const started = job.status === AutomationJobStatus.IN_PROGRESS || job.status === AutomationJobStatus.NEEDS_REVIEW;
  if (started && (!job.claimedByAgentId || !job.agentRunId)) {
    throw new HttpError(409, 'Stop this application using Stop automation in the Agent.');
  }
  if (started) {
    const owner = await tx.agentRegistration.findFirst({
      where: { id: job.claimedByAgentId!, organisationId: input.organisationId }, select: { agentVersion: true },
    });
    const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(owner?.agentVersion ?? '');
    if (!version || Number(version[1]) < 4 || (Number(version[1]) === 4
      && (Number(version[2]) < 2 || (Number(version[2]) === 2 && Number(version[3]) < 3)))) {
      throw new HttpError(409, 'Update to Agent 4.2.3 to cancel from the queue, or use Stop automation in your current Agent.');
    }
  }
  const now = new Date();
  const changed = await tx.automationJob.updateMany({
    where: { id: job.id, organisationId: input.organisationId, status: job.status,
      claimedByAgentId: job.claimedByAgentId, agentRunId: job.agentRunId },
    data: { status: AutomationJobStatus.CANCELLED, executionAuthorisedAt: null,
      progressStageState: started ? 'stopping' : 'cancelled',
      progressMessage: started ? 'Stopping safely…' : 'Cancelled before starting',
      resultSummary: 'Automation cancelled. The prepared application has been kept.', completedAt: now },
  });
  if (!changed.count) throw new HttpError(409, 'This job has changed. Refresh the queue and try again.');
  await tx.automationJobEvent.create({
    data: { organisationId: input.organisationId, automationJobId: job.id, eventType: 'cancellation_requested',
      idempotencyKey: `cancel:${input.organisationId}:${job.id}:${job.agentRunId ?? 'unclaimed'}`,
      payload: { userId: input.userId ?? null, agentId: input.agent?.id ?? null,
        agentRunId: job.agentRunId, previousStatus: job.status } },
  });
  await recordAutomationOwnership(tx, { organisationId: input.organisationId, jobId: job.id }, { reason: 'cancellation_requested' });
  await resolveAgentAction(tx, input.organisationId, waitingAgentActionKey(job.id));
  await resolveAgentAction(tx, input.organisationId, connectionLostActionKey(job.id));
  // A CLAIMED job has never received permission to touch the council portal.
  // Its start acknowledgement is now fenced; release it immediately.
  if (!started && job.claimedByAgentId && job.agentRunId) {
    await releaseAgentExecution(tx, input.organisationId, job.claimedByAgentId, job.id, job.agentRunId);
  }
  return { pending: started };
});
