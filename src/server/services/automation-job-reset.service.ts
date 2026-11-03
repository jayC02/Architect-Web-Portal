import { randomUUID } from 'node:crypto';
import { ActionItemStatus, AutomationJobStatus, AutomationJobType, DeadlineStatus, PlanningStatus, Prisma, WarrantStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';
import { buildFreshAutomationJob } from '@/server/services/automation-jobs.service';
import { automationJobApplicationId, desktopAutomationJobSelect, selectCurrentAutomationJob } from '@/server/services/desktop-automation-status.service';
import { lockOrganisationExecution, releaseAgentExecution } from '@/server/services/desktop-execution.service';
import { recordAuthorisedSnapshot, recordAutomationOwnership } from '@/server/services/automation-state-model.service';
import { workflowActionKeys } from '@/server/services/phase2-workflow-handlers.service';

type ResetInput = {
  organisation: { id: string; name: string };
  actor: { id: string; name: string | null; email: string };
  applicationId: string;
  type: 'HOUSEHOLDER_PLANNING' | 'BUILDING_WARRANT';
  expectedJobId: string | null;
  requestId: string;
};
const objectValue = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const terminal = new Set<AutomationJobStatus>(['COMPLETED', 'FAILED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCELLED']);

export const resetAutomationJobInTransaction = async (tx: Prisma.TransactionClient, input: ResetInput) => {
  // Claims, starts, cancellations and results all hold this same lock.
  await lockOrganisationExecution(tx, input.organisation.id);
  const isWarrant = input.type === AutomationJobType.BUILDING_WARRANT;
  const application = isWarrant
    ? await tx.buildingWarrantApplication.findFirst({ where: { id: input.applicationId, organisationId: input.organisation.id } })
    : await tx.planningApplication.findFirst({ where: { id: input.applicationId, organisationId: input.organisation.id } });
  if (!application) throw new HttpError(404, 'Application not found.');
  const key = `automation-reset:${input.organisation.id}:${input.type}:${application.id}:${input.requestId}`;
  const prior = await tx.automationJobEvent.findUnique({ where: { idempotencyKey: key } });
  if (prior) {
    const newJobId = objectValue(prior.payload).newJobId;
    const job = await tx.automationJob.findFirst({ where: { id: typeof newJobId === 'string' ? newJobId : '', organisationId: input.organisation.id, projectId: application.projectId }, select: desktopAutomationJobSelect });
    if (!job) throw new HttpError(409, 'The reset was saved, but its run is no longer available. Refresh the project.');
    return job;
  }
  const types = isWarrant ? [AutomationJobType.BUILDING_WARRANT] : [AutomationJobType.HOUSEHOLDER_PLANNING, AutomationJobType.PLANNING_APPLICATION];
  const candidates = await tx.automationJob.findMany({ where: { organisationId: input.organisation.id, projectId: application.projectId, type: { in: types } }, select: { ...desktopAutomationJobSelect, claimedByAgentId: true } });
  const current = selectCurrentAutomationJob(candidates, { projectId: application.projectId, types, applicationId: application.id });
  if ((current?.id ?? null) !== input.expectedJobId) throw new HttpError(409, 'This application has a newer run. Refresh the project before resetting it.');
  const superseded = await tx.automationJobEvent.findFirst({ where: current ? {
    organisationId: input.organisation.id, automationJobId: current.id, eventType: 'superseded_by_reset',
  } : { organisationId: input.organisation.id, eventType: 'application_run_reset',
    payload: { path: ['previousApplicationId'], equals: application.id } }, select: { id: true } });
  if (superseded) throw new HttpError(409, 'This application already has a fresh reset. Refresh the project to see its new run.');
  const oldJobs = candidates.filter(job => automationJobApplicationId(job) === application.id);
  const now = new Date();
  const preparationData = { ...objectValue(application.preparationData), portalDraftKey: randomUUID() } as Prisma.InputJsonObject;
  let targetApplicationId = application.id;
  // A new automation attempt must never undo a recorded submission/decision.
  // For progressed applications, retain that record and start a new draft.
  if (isWarrant) {
    const warrant = application as Prisma.BuildingWarrantApplicationGetPayload<{}>;
    if (!['NOT_STARTED', 'DRAFTING'].includes(warrant.status) || warrant.submissionDate) {
      targetApplicationId = (await tx.buildingWarrantApplication.create({ data: {
        organisationId: input.organisation.id, projectId: warrant.projectId, status: WarrantStatus.DRAFTING,
        warrantType: warrant.warrantType, presetKey: warrant.presetKey, presetVersion: warrant.presetVersion,
        description: warrant.description, estimatedValue: warrant.estimatedValue, currentUse: warrant.currentUse, proposedUse: warrant.proposedUse,
        selectedCertifierPresetId: warrant.selectedCertifierPresetId, preparationData, preparedAt: now,
      }, select: { id: true } })).id;
    } else await tx.buildingWarrantApplication.update({ where: { id: warrant.id }, data: { preparationData, reviewedAt: null, preparedAt: now } });
  } else {
    const planning = application as Prisma.PlanningApplicationGetPayload<{}>;
    if (!['NOT_STARTED', 'DRAFTING'].includes(planning.status) || planning.submissionDate) {
      targetApplicationId = (await tx.planningApplication.create({ data: {
        organisationId: input.organisation.id, projectId: planning.projectId, status: PlanningStatus.DRAFTING,
        description: planning.description, preparationData, preparedAt: now,
      }, select: { id: true } })).id;
    } else await tx.planningApplication.update({ where: { id: planning.id }, data: { preparationData, reviewedAt: null, preparedAt: now } });
  }
  const { jobId, createdAt, snapshot } = await buildFreshAutomationJob({
    organisationId: input.organisation.id, organisationName: input.organisation.name,
    projectId: application.projectId, type: input.type,
    createdBy: { ...input.actor, name: input.actor.name || input.actor.email },
    planningApplicationId: isWarrant ? undefined : targetApplicationId,
    buildingWarrantApplicationId: isWarrant ? targetApplicationId : undefined,
  }, tx);
  for (const old of oldJobs) {
    if (!terminal.has(old.status)) {
      if (['IN_PROGRESS', 'NEEDS_REVIEW'].includes(old.status) && (!old.agentRunId || !old.claimedByAgentId)) {
        throw new HttpError(409, 'Stop the running application in the desktop Agent, then reset it here.');
      }
      const started = ['IN_PROGRESS', 'NEEDS_REVIEW', 'AWAITING_PORTAL_REVIEW'].includes(old.status);
      const cancelled = await tx.automationJob.updateMany({ where: { id: old.id, organisationId: input.organisation.id, status: old.status }, data: {
        status: AutomationJobStatus.CANCELLED, executionAuthorisedAt: null,
        browserRevealRequestedAt: null, progressStageState: started ? 'stopping' : 'cancelled',
        progressMessage: started ? 'Stopping previous run after reset…' : 'Replaced by a fresh run', completedAt: now,
      } });
      if (!cancelled.count) throw new HttpError(409, 'The previous run changed while resetting. Refresh the project and try again.');
      await recordAutomationOwnership(tx, { organisationId: input.organisation.id, jobId: old.id }, { reason: 'application_reset' });
      if (!started && old.agentRunId) {
        const owner = await tx.automationJob.findFirst({ where: { id: old.id, organisationId: input.organisation.id }, select: { claimedByAgentId: true } });
        if (owner?.claimedByAgentId) await releaseAgentExecution(tx, input.organisation.id, owner.claimedByAgentId, old.id, old.agentRunId);
      }
    }
    await tx.automationJob.updateMany({ where: { id: old.id, organisationId: input.organisation.id }, data: { browserRevealRequestedAt: null } });
    await tx.automationJobEvent.upsert({ where: { idempotencyKey: `reset-supersedes:${input.organisation.id}:${old.id}` }, update: {}, create: {
      organisationId: input.organisation.id, automationJobId: old.id, eventType: 'superseded_by_reset',
      idempotencyKey: `reset-supersedes:${input.organisation.id}:${old.id}`,
      payload: { newJobId: jobId, userId: input.actor.id },
    } });
    await tx.actionItem.updateMany({ where: { organisationId: input.organisation.id, status: ActionItemStatus.OPEN,
      dedupeKey: { startsWith: `automation:${old.id}:` } }, data: { status: ActionItemStatus.RESOLVED, resolvedAt: now } });
    await tx.deadline.updateMany({ where: { organisationId: input.organisation.id, sourceKey: `automation-job:${old.id}:retry`, status: { notIn: [DeadlineStatus.COMPLETED, DeadlineStatus.CANCELLED] } }, data: { status: DeadlineStatus.CANCELLED } });
  }
  await tx.actionItem.updateMany({ where: { organisationId: input.organisation.id, status: ActionItemStatus.OPEN,
    dedupeKey: isWarrant ? workflowActionKeys.warrantFinalReview(application.id) : workflowActionKeys.planningFinalReview(application.id) },
    data: { status: ActionItemStatus.RESOLVED, resolvedAt: now } });
  const job = await tx.automationJob.create({ data: {
    id: jobId, organisationId: input.organisation.id, projectId: application.projectId, type: input.type,
    status: snapshot.preflight.status === 'READY' ? AutomationJobStatus.READY : AutomationJobStatus.NEEDS_INPUT,
    sourceType: snapshot.sourceType, title: snapshot.title, payloadVersion: 2, snapshotHash: snapshot.snapshotHash,
    sourceUpdatedAt: snapshot.sourceUpdatedAt, preparedAt: now, createdAt, createdById: input.actor.id,
    dataSnapshot: snapshot.dataSnapshot as Prisma.InputJsonValue, documentSnapshot: snapshot.documentSnapshot as Prisma.InputJsonValue,
    executionAuthorisedAt: null, resultSummary: 'Reset with the latest saved details. Ready for a new run.',
  }, select: desktopAutomationJobSelect });
  await recordAuthorisedSnapshot(tx, { organisationId: input.organisation.id, jobId });
  await tx.automationJobEvent.create({ data: { organisationId: input.organisation.id, automationJobId: job.id,
    idempotencyKey: key, eventType: 'application_run_reset', payload: { newJobId: job.id, applicationId: targetApplicationId, previousApplicationId: application.id, previousJobId: current?.id ?? null, userId: input.actor.id } } });
  return job;
};

export const resetAutomationJob = async (input: ResetInput) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(tx => resetAutomationJobInTransaction(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
    } catch (error) {
      if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
    }
  }
};
