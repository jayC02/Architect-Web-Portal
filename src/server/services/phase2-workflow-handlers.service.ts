import {
  ActionItemKind,
  ActionItemPriority,
  ActionItemStatus,
  PlanningStatus,
  ProjectStage,
  ProjectStatus,
  ProjectActivityEventType,
  ProjectActivityVisibility,
  WarrantStatus,
  WorkflowTargetKey,
  type PrismaClient,
} from '@prisma/client';
import { z } from 'zod';
import type { LifecycleHandlerKey } from '@/server/services/lifecycle-events.service';
import type { EffectHandler, EffectWithEvent } from '@/server/services/workflow-effect-types';
import { PermanentWorkflowEffectError } from '@/server/services/workflow-effect-errors';
import {
  completeWorkflowDeadline,
  ensureWorkflowDeadline,
} from '@/server/services/workflow-deadlines.service';
import {
  calculateWorkflowTargetDate,
  getWorkflowTarget,
} from '@/server/services/workflow-targets.service';
import { readBuildingWarrantReadiness } from '@/server/services/building-warrant-readiness.service';

export const workflowSourceKeys = {
  documentReview: (projectId: string) => `workflow:project:${projectId}:document-review`,
  planningPreparation: (planningApplicationId: string) => `workflow:planning:${planningApplicationId}:preparation`,
  planningFinalReview: (planningApplicationId: string) => `workflow:planning:${planningApplicationId}:final-review`,
  warrantAction: (buildingWarrantApplicationId: string) => `workflow:warrant:${buildingWarrantApplicationId}:activate`,
  warrantFinalReview: (buildingWarrantApplicationId: string) => `workflow:warrant:${buildingWarrantApplicationId}:final-review`,
};

export const workflowActionKeys = {
  documentReview: (projectId: string) => `project:${projectId}:document-review`,
  planningPreparation: (planningApplicationId: string) => `planning:${planningApplicationId}:preparation`,
  planningFinalReview: (planningApplicationId: string) => `planning:${planningApplicationId}:final-review`,
  warrantAction: (buildingWarrantApplicationId: string) => `warrant:${buildingWarrantApplicationId}:activate`,
  warrantFinalReview: (buildingWarrantApplicationId: string) => `warrant:${buildingWarrantApplicationId}:final-review`,
};

const documentReviewPayload = z.object({
  projectId: z.string().min(1),
  applicationDraftId: z.string().min(1),
  planningApplicationId: z.string().min(1).nullable(),
  buildingWarrantApplicationId: z.string().min(1).nullable(),
}).strict();
const planningPayload = z.object({
  projectId: z.string().min(1),
  planningApplicationId: z.string().min(1),
  trackedEmailId: z.string().min(1).optional(),
}).passthrough();
const warrantPayload = z.object({
  projectId: z.string().min(1),
  buildingWarrantApplicationId: z.string().min(1),
}).strict();

const assertEnvelope = (effect: EffectWithEvent, projectId: string) => {
  if (
    effect.organisationId !== effect.lifecycleEvent.organisationId
    || effect.lifecycleEvent.projectId !== projectId
  ) {
    throw new PermanentWorkflowEffectError('Lifecycle event payload does not match its organisation or project.');
  }
};

const loadProject = async (effect: EffectWithEvent, database: PrismaClient, projectId: string) => {
  assertEnvelope(effect, projectId);
  const project = await database.project.findFirst({
    where: { id: projectId, organisationId: effect.organisationId },
    select: { id: true, name: true, stage: true, status: true },
  });
  if (!project) throw new PermanentWorkflowEffectError('Lifecycle project no longer exists in this organisation.');
  return project;
};

const loadPlanning = async (effect: EffectWithEvent, database: PrismaClient) => {
  const payload = planningPayload.parse(effect.lifecycleEvent.payload);
  const project = await loadProject(effect, database, payload.projectId);
  const application = await database.planningApplication.findFirst({
    where: {
      id: payload.planningApplicationId,
      organisationId: effect.organisationId,
      projectId: project.id,
    },
  });
  if (!application) throw new PermanentWorkflowEffectError('Planning application no longer exists in this organisation.');
  return { project, application };
};

const loadWarrant = async (effect: EffectWithEvent, database: PrismaClient) => {
  const payload = warrantPayload.parse(effect.lifecycleEvent.payload);
  const project = await loadProject(effect, database, payload.projectId);
  const application = await database.buildingWarrantApplication.findFirst({
    where: {
      id: payload.buildingWarrantApplicationId,
      organisationId: effect.organisationId,
      projectId: project.id,
    },
  });
  if (!application) throw new PermanentWorkflowEffectError('Building Warrant application no longer exists in this organisation.');
  return { project, application };
};

const resolveAction = (
  database: PrismaClient,
  organisationId: string,
  dedupeKey: string,
  resolvedAt: Date,
) => database.actionItem.updateMany({
  where: { organisationId, dedupeKey, status: ActionItemStatus.OPEN },
  data: { status: ActionItemStatus.RESOLVED, resolvedAt },
});

const ensureAction = async (
  effect: EffectWithEvent,
  database: PrismaClient,
  input: {
    projectId: string;
    kind: ActionItemKind;
    title: string;
    summary: string;
    actionUrl: string;
    dedupeKey: string;
    targetKey: WorkflowTargetKey;
    reopen?: boolean;
    priority?: ActionItemPriority;
  },
) => {
  const target = await getWorkflowTarget(database, effect.organisationId, input.targetKey);
  const dueAt = target.enabled
    ? calculateWorkflowTargetDate(effect.lifecycleEvent.occurredAt, target.offsetDays)
    : null;
  const existing = await database.actionItem.findUnique({
    where: {
      organisationId_dedupeKey: {
        organisationId: effect.organisationId,
        dedupeKey: input.dedupeKey,
      },
    },
    select: { status: true, resolvedAt: true },
  });
  const preserveResolved = existing?.status === ActionItemStatus.RESOLVED && !input.reopen;
  return database.actionItem.upsert({
    where: {
      organisationId_dedupeKey: {
        organisationId: effect.organisationId,
        dedupeKey: input.dedupeKey,
      },
    },
    update: {
      title: input.title,
      summary: input.summary,
      actionUrl: input.actionUrl,
      priority: input.priority ?? ActionItemPriority.MEDIUM,
      status: preserveResolved ? ActionItemStatus.RESOLVED : ActionItemStatus.OPEN,
      availableAt: effect.lifecycleEvent.occurredAt,
      dueAt,
      resolvedAt: preserveResolved ? existing.resolvedAt : null,
    },
    create: {
      organisationId: effect.organisationId,
      projectId: input.projectId,
      sourceLifecycleEventId: effect.lifecycleEvent.id,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      actionUrl: input.actionUrl,
      priority: input.priority ?? ActionItemPriority.MEDIUM,
      status: ActionItemStatus.OPEN,
      availableAt: effect.lifecycleEvent.occurredAt,
      dueAt,
      dedupeKey: input.dedupeKey,
    },
  });
};

const appendActivity = (
  effect: EffectWithEvent,
  database: PrismaClient,
  eventType: ProjectActivityEventType,
  summary: string,
  identity = 'activity',
) => database.projectActivity.upsert({
  where: {
    organisationId_idempotencyKey: {
      organisationId: effect.organisationId,
      idempotencyKey: `lifecycle:${effect.lifecycleEvent.id}:${identity}`,
    },
  },
  update: {},
  create: {
    organisationId: effect.organisationId,
    projectId: effect.lifecycleEvent.projectId,
    sourceLifecycleEventId: effect.lifecycleEvent.id,
    eventType,
    summary,
    actorType: effect.lifecycleEvent.actorType,
    actorUserId: effect.lifecycleEvent.actorUserId,
    sourceType: 'LIFECYCLE_EVENT',
    sourceId: effect.lifecycleEvent.id,
    visibility: ProjectActivityVisibility.STANDARD,
    occurredAt: effect.lifecycleEvent.occurredAt,
    idempotencyKey: `lifecycle:${effect.lifecycleEvent.id}:${identity}`,
  },
});

const syncDeadline = async (
  effect: EffectWithEvent,
  deadline: { id: string } | null,
  calendarSync: EffectParameters['calendarSync'],
) => {
  if (!deadline) return;
  const result = await calendarSync(effect.organisationId, deadline.id);
  if (result.attempted && !result.synced) throw new Error('Google Calendar deadline reconciliation failed.');
};

type EffectParameters = Parameters<EffectHandler>[1];
const planningHasProgressed = (status: PlanningStatus) => !new Set<PlanningStatus>([
  PlanningStatus.NOT_STARTED,
  PlanningStatus.DRAFTING,
]).has(status);
const warrantHasProgressed = (status: WarrantStatus) => !new Set<WarrantStatus>([
  WarrantStatus.NOT_STARTED,
  WarrantStatus.DRAFTING,
]).has(status);

const documentReviewAction: EffectHandler = async (effect, { database }) => {
  const payload = documentReviewPayload.parse(effect.lifecycleEvent.payload);
  await loadProject(effect, database, payload.projectId);
  await resolveAction(database, effect.organisationId, workflowActionKeys.documentReview(payload.projectId), effect.lifecycleEvent.occurredAt);
  if (!payload.planningApplicationId) return;
  const planning = await database.planningApplication.findFirst({
    where: {
      id: payload.planningApplicationId,
      organisationId: effect.organisationId,
      projectId: payload.projectId,
    },
    select: { status: true },
  });
  if (!planning || planningHasProgressed(planning.status)) return;
  const finalAction = await database.actionItem.findUnique({
    where: {
      organisationId_dedupeKey: {
        organisationId: effect.organisationId,
        dedupeKey: workflowActionKeys.planningFinalReview(payload.planningApplicationId),
      },
    },
    select: { id: true },
  });
  if (finalAction) return;
  await ensureAction(effect, database, {
    projectId: payload.projectId,
    kind: ActionItemKind.PLANNING_PREPARATION,
    title: 'Prepare Planning application',
    summary: 'Complete the Planning details and required preflight checks.',
    actionUrl: `/planning/${payload.planningApplicationId}/preparation`,
    dedupeKey: workflowActionKeys.planningPreparation(payload.planningApplicationId),
    targetKey: WorkflowTargetKey.PLANNING_PREPARATION,
  });
};

const documentReviewActivity: EffectHandler = async (effect, { database }) => {
  await appendActivity(effect, database, ProjectActivityEventType.DOCUMENT_REVIEW_COMPLETED, 'Document review completed');
};

const documentReviewDeadline: EffectHandler = async (effect, { database, calendarSync }) => {
  const payload = documentReviewPayload.parse(effect.lifecycleEvent.payload);
  await loadProject(effect, database, payload.projectId);
  const completed = await completeWorkflowDeadline(
    database,
    effect.organisationId,
    workflowSourceKeys.documentReview(payload.projectId),
    effect.lifecycleEvent.occurredAt,
  );
  await syncDeadline(effect, completed, calendarSync);
  if (!payload.planningApplicationId) return;
  const finalDeadline = await database.deadline.findUnique({
    where: {
      organisationId_sourceKey: {
        organisationId: effect.organisationId,
        sourceKey: workflowSourceKeys.planningFinalReview(payload.planningApplicationId),
      },
    },
    select: { id: true },
  });
  if (finalDeadline) return;
  const planning = await database.planningApplication.findFirst({
    where: { id: payload.planningApplicationId, organisationId: effect.organisationId, projectId: payload.projectId },
    select: { id: true, status: true },
  });
  if (!planning || planningHasProgressed(planning.status)) return;
  const created = await ensureWorkflowDeadline(database, {
    organisationId: effect.organisationId,
    projectId: payload.projectId,
    planningApplicationId: planning.id,
    sourceKey: workflowSourceKeys.planningPreparation(planning.id),
    title: 'Prepare Planning application',
    description: 'Internal practice target for completing Planning details and preflight checks.',
    targetKey: WorkflowTargetKey.PLANNING_PREPARATION,
    occurredAt: effect.lifecycleEvent.occurredAt,
  });
  await syncDeadline(effect, created, calendarSync);
};

const planningReadyAction: EffectHandler = async (effect, { database }) => {
  const { project, application } = await loadPlanning(effect, database);
  await resolveAction(database, effect.organisationId, workflowActionKeys.planningPreparation(application.id), effect.lifecycleEvent.occurredAt);
  if (planningHasProgressed(application.status)) return;
  await ensureAction(effect, database, {
    projectId: project.id,
    kind: ActionItemKind.PLANNING_FINAL_REVIEW,
    title: 'Planning ready — final review and run',
    summary: 'Review the prepared Planning application before running it in desktop.',
    actionUrl: `/projects/${project.id}#planning`,
    dedupeKey: workflowActionKeys.planningFinalReview(application.id),
    targetKey: WorkflowTargetKey.PLANNING_FINAL_REVIEW,
  });
};

const planningReadyActivity: EffectHandler = async (effect, { database }) => {
  await appendActivity(effect, database, ProjectActivityEventType.PLANNING_READY, 'Planning ready');
};

const planningReadyDeadline: EffectHandler = async (effect, { database, calendarSync }) => {
  const { project, application } = await loadPlanning(effect, database);
  const completed = await completeWorkflowDeadline(database, effect.organisationId, workflowSourceKeys.planningPreparation(application.id), effect.lifecycleEvent.occurredAt);
  await syncDeadline(effect, completed, calendarSync);
  if (planningHasProgressed(application.status)) return;
  const created = await ensureWorkflowDeadline(database, {
    organisationId: effect.organisationId,
    projectId: project.id,
    planningApplicationId: application.id,
    sourceKey: workflowSourceKeys.planningFinalReview(application.id),
    title: 'Planning ready — final review and run',
    description: 'Internal practice target for final review and running the prepared Planning application.',
    targetKey: WorkflowTargetKey.PLANNING_FINAL_REVIEW,
    occurredAt: effect.lifecycleEvent.occurredAt,
  });
  await syncDeadline(effect, created, calendarSync);
};

const planningReadinessRevokedAction: EffectHandler = async (effect, { database }) => {
  const { project, application } = await loadPlanning(effect, database);
  await resolveAction(database, effect.organisationId, workflowActionKeys.planningFinalReview(application.id), effect.lifecycleEvent.occurredAt);
  if (planningHasProgressed(application.status)) return;
  await ensureAction(effect, database, {
    projectId: project.id,
    kind: ActionItemKind.PLANNING_PREPARATION,
    title: 'Prepare Planning application',
    summary: 'Complete the missing Planning details and preflight checks.',
    actionUrl: `/planning/${application.id}/preparation`,
    dedupeKey: workflowActionKeys.planningPreparation(application.id),
    targetKey: WorkflowTargetKey.PLANNING_PREPARATION,
    reopen: true,
  });
};

const planningReadinessRevokedDeadline: EffectHandler = async (effect, { database, calendarSync }) => {
  const { project, application } = await loadPlanning(effect, database);
  const completed = await completeWorkflowDeadline(database, effect.organisationId, workflowSourceKeys.planningFinalReview(application.id), effect.lifecycleEvent.occurredAt);
  await syncDeadline(effect, completed, calendarSync);
  if (planningHasProgressed(application.status)) return;
  const reopened = await ensureWorkflowDeadline(database, {
    organisationId: effect.organisationId,
    projectId: project.id,
    planningApplicationId: application.id,
    sourceKey: workflowSourceKeys.planningPreparation(application.id),
    title: 'Prepare Planning application',
    description: 'Internal practice target for completing missing Planning details and preflight checks.',
    targetKey: WorkflowTargetKey.PLANNING_PREPARATION,
    occurredAt: effect.lifecycleEvent.occurredAt,
    reopen: true,
  });
  await syncDeadline(effect, reopened, calendarSync);
};

const planningSubmittedAction: EffectHandler = async (effect, { database }) => {
  const { application } = await loadPlanning(effect, database);
  await resolveAction(database, effect.organisationId, workflowActionKeys.planningFinalReview(application.id), effect.lifecycleEvent.occurredAt);
};
const planningSubmittedActivity: EffectHandler = async (effect, { database }) => {
  await appendActivity(effect, database, ProjectActivityEventType.PLANNING_SUBMITTED, 'Planning submitted');
};
const planningSubmittedDeadline: EffectHandler = async (effect, { database, calendarSync }) => {
  const { application } = await loadPlanning(effect, database);
  const completed = await completeWorkflowDeadline(database, effect.organisationId, workflowSourceKeys.planningFinalReview(application.id), effect.lifecycleEvent.occurredAt);
  await syncDeadline(effect, completed, calendarSync);
};

const planningValidatedActivity: EffectHandler = async (effect, { database }) => {
  await loadPlanning(effect, database);
  await appendActivity(effect, database, ProjectActivityEventType.PLANNING_VALIDATED, 'Planning validation received from council correspondence');
};

const planningInformationRequestedAction: EffectHandler = async (effect, { database }) => {
  const payload = planningPayload.parse(effect.lifecycleEvent.payload);
  const { project, application } = await loadPlanning(effect, database);
  await ensureAction(effect, database, {
    projectId: project.id,
    kind: ActionItemKind.PLANNING_CORRESPONDENCE,
    title: 'Council requested additional Planning information',
    summary: 'Review the council correspondence and provide the requested information. No response deadline has been assumed.',
    actionUrl: payload.trackedEmailId
      ? `/email-updates?email=${encodeURIComponent(payload.trackedEmailId)}`
      : `/projects/${project.id}#planning`,
    dedupeKey: `planning:${application.id}:information-requested`,
    targetKey: WorkflowTargetKey.PLANNING_FINAL_REVIEW,
    priority: ActionItemPriority.HIGH,
    reopen: true,
  });
};

const planningInformationRequestedActivity: EffectHandler = async (effect, { database }) => {
  await loadPlanning(effect, database);
  await appendActivity(effect, database, ProjectActivityEventType.PLANNING_INFORMATION_REQUESTED, 'Council requested additional Planning information');
};

const latestWarrant = (database: PrismaClient, organisationId: string, projectId: string) =>
  database.buildingWarrantApplication.findFirst({
    where: { organisationId, projectId },
    orderBy: { createdAt: 'desc' },
  });

const planningApprovedAction: EffectHandler = async (effect, { database }) => {
  const { project, application } = await loadPlanning(effect, database);
  await resolveAction(database, effect.organisationId, workflowActionKeys.planningFinalReview(application.id), effect.lifecycleEvent.occurredAt);
  await database.actionItem.updateMany({
    where: {
      organisationId: effect.organisationId,
      projectId: project.id,
      status: ActionItemStatus.OPEN,
      kind: { in: [ActionItemKind.PLANNING_PREPARATION, ActionItemKind.PLANNING_FINAL_REVIEW, ActionItemKind.PLANNING_CORRESPONDENCE] },
    },
    data: { status: ActionItemStatus.RESOLVED, resolvedAt: effect.lifecycleEvent.occurredAt },
  });
  const warrant = await latestWarrant(database, effect.organisationId, project.id);
  if (!warrant) {
    await ensureAction(effect, database, {
      projectId: project.id,
      kind: ActionItemKind.BUILDING_WARRANT_ACTION,
      title: 'Planning approved — confirm whether a Building Warrant is required',
      summary: 'This project has no prepared Building Warrant. Confirm whether one is required before proceeding.',
      actionUrl: `/projects/${project.id}#building-warrant`,
      dedupeKey: `planning:${application.id}:confirm-warrant-required`,
      targetKey: WorkflowTargetKey.BUILDING_WARRANT_ACTION,
    });
    return;
  }
  if (warrantHasProgressed(warrant.status)) return;
  const finalAction = await database.actionItem.findUnique({
    where: { organisationId_dedupeKey: { organisationId: effect.organisationId, dedupeKey: workflowActionKeys.warrantFinalReview(warrant.id) } },
    select: { id: true },
  });
  if (finalAction) return;
  const readiness = await readBuildingWarrantReadiness(database, {
    organisationId: effect.organisationId,
    projectId: project.id,
    buildingWarrantApplicationId: warrant.id,
  });
  await ensureAction(effect, database, {
    projectId: project.id,
    kind: ActionItemKind.BUILDING_WARRANT_ACTION,
    title: readiness.title,
    summary: readiness.summary,
    actionUrl: `/building-warrant/${warrant.id}/preparation`,
    dedupeKey: workflowActionKeys.warrantAction(warrant.id),
    targetKey: WorkflowTargetKey.BUILDING_WARRANT_ACTION,
  });
};
const planningApprovedActivity: EffectHandler = async (effect, { database }) => {
  await appendActivity(effect, database, ProjectActivityEventType.PLANNING_APPROVED, 'Planning approved');
};
const planningApprovedDeadline: EffectHandler = async (effect, { database, calendarSync }) => {
  const { project, application } = await loadPlanning(effect, database);
  const planningDeadline = await completeWorkflowDeadline(database, effect.organisationId, workflowSourceKeys.planningFinalReview(application.id), effect.lifecycleEvent.occurredAt);
  await syncDeadline(effect, planningDeadline, calendarSync);
  const warrant = await latestWarrant(database, effect.organisationId, project.id);
  if (!warrant || warrantHasProgressed(warrant.status)) return;
  const finalDeadline = await database.deadline.findUnique({
    where: { organisationId_sourceKey: { organisationId: effect.organisationId, sourceKey: workflowSourceKeys.warrantFinalReview(warrant.id) } },
    select: { id: true },
  });
  if (finalDeadline) return;
  const readiness = await readBuildingWarrantReadiness(database, {
    organisationId: effect.organisationId,
    projectId: project.id,
    buildingWarrantApplicationId: warrant.id,
  });
  const created = await ensureWorkflowDeadline(database, {
    organisationId: effect.organisationId,
    projectId: project.id,
    buildingWarrantApplicationId: warrant.id,
    sourceKey: workflowSourceKeys.warrantAction(warrant.id),
    title: readiness.title,
    description: readiness.summary,
    targetKey: WorkflowTargetKey.BUILDING_WARRANT_ACTION,
    occurredAt: effect.lifecycleEvent.occurredAt,
  });
  await syncDeadline(effect, created, calendarSync);
};

const planningApprovedStage: EffectHandler = async (effect, { database }) => {
  const { project } = await loadPlanning(effect, database);
  if (project.status !== ProjectStatus.ACTIVE) return;
  if (!new Set<ProjectStage>([ProjectStage.LEAD, ProjectStage.SURVEY, ProjectStage.DESIGN, ProjectStage.PLANNING]).has(project.stage)) return;
  const warrant = await latestWarrant(database, effect.organisationId, project.id);
  if (!warrant) return;
  await database.project.updateMany({
    where: {
      id: project.id,
      organisationId: effect.organisationId,
      status: ProjectStatus.ACTIVE,
      stage: { in: [ProjectStage.LEAD, ProjectStage.SURVEY, ProjectStage.DESIGN, ProjectStage.PLANNING] },
    },
    data: { stage: ProjectStage.BUILDING_WARRANT },
  });
};

const warrantActivatedAfterPlanningActivity: EffectHandler = async (effect, { database }) => {
  const { project } = await loadPlanning(effect, database);
  const warrant = await latestWarrant(database, effect.organisationId, project.id);
  if (!warrant) return;
  const readiness = await readBuildingWarrantReadiness(database, {
    organisationId: effect.organisationId,
    projectId: project.id,
    buildingWarrantApplicationId: warrant.id,
  });
  await appendActivity(
    effect,
    database,
    ProjectActivityEventType.BUILDING_WARRANT_ACTIVATED,
    `Building Warrant activated after Planning approval — ${readiness.state === 'READY' ? 'ready' : readiness.state === 'INCOMPLETE' ? `${readiness.missingCount} confirmations needed` : 'project information needed'}`,
    'warrant-activated',
  );
};

const warrantReadyAction: EffectHandler = async (effect, { database }) => {
  const { project, application } = await loadWarrant(effect, database);
  await resolveAction(database, effect.organisationId, workflowActionKeys.warrantAction(application.id), effect.lifecycleEvent.occurredAt);
  if (warrantHasProgressed(application.status)) return;
  await ensureAction(effect, database, {
    projectId: project.id,
    kind: ActionItemKind.BUILDING_WARRANT_FINAL_REVIEW,
    title: 'Building Warrant ready — final review and run',
    summary: 'Review the prepared Building Warrant application before running it in desktop.',
    actionUrl: `/projects/${project.id}#building-warrant`,
    dedupeKey: workflowActionKeys.warrantFinalReview(application.id),
    targetKey: WorkflowTargetKey.BUILDING_WARRANT_FINAL_REVIEW,
  });
};
const warrantReadyActivity: EffectHandler = async (effect, { database }) => {
  await appendActivity(effect, database, ProjectActivityEventType.BUILDING_WARRANT_READY, 'Building Warrant ready');
};
const warrantReadyDeadline: EffectHandler = async (effect, { database, calendarSync }) => {
  const { project, application } = await loadWarrant(effect, database);
  const completed = await completeWorkflowDeadline(database, effect.organisationId, workflowSourceKeys.warrantAction(application.id), effect.lifecycleEvent.occurredAt);
  await syncDeadline(effect, completed, calendarSync);
  if (warrantHasProgressed(application.status)) return;
  const created = await ensureWorkflowDeadline(database, {
    organisationId: effect.organisationId,
    projectId: project.id,
    buildingWarrantApplicationId: application.id,
    sourceKey: workflowSourceKeys.warrantFinalReview(application.id),
    title: 'Building Warrant ready — final review and run',
    description: 'Internal practice target for final review and running the prepared Building Warrant application.',
    targetKey: WorkflowTargetKey.BUILDING_WARRANT_FINAL_REVIEW,
    occurredAt: effect.lifecycleEvent.occurredAt,
  });
  await syncDeadline(effect, created, calendarSync);
};

const warrantReadinessRevokedAction: EffectHandler = async (effect, { database }) => {
  const { project, application } = await loadWarrant(effect, database);
  await resolveAction(database, effect.organisationId, workflowActionKeys.warrantFinalReview(application.id), effect.lifecycleEvent.occurredAt);
  if (warrantHasProgressed(application.status)) return;
  await ensureAction(effect, database, {
    projectId: project.id,
    kind: ActionItemKind.BUILDING_WARRANT_ACTION,
    title: 'Continue Building Warrant preparation',
    summary: 'Complete the missing Building Warrant details and preflight checks.',
    actionUrl: `/building-warrant/${application.id}/preparation`,
    dedupeKey: workflowActionKeys.warrantAction(application.id),
    targetKey: WorkflowTargetKey.BUILDING_WARRANT_ACTION,
    reopen: true,
  });
};
const warrantReadinessRevokedDeadline: EffectHandler = async (effect, { database, calendarSync }) => {
  const { project, application } = await loadWarrant(effect, database);
  const completed = await completeWorkflowDeadline(database, effect.organisationId, workflowSourceKeys.warrantFinalReview(application.id), effect.lifecycleEvent.occurredAt);
  await syncDeadline(effect, completed, calendarSync);
  if (warrantHasProgressed(application.status)) return;
  const reopened = await ensureWorkflowDeadline(database, {
    organisationId: effect.organisationId,
    projectId: project.id,
    buildingWarrantApplicationId: application.id,
    sourceKey: workflowSourceKeys.warrantAction(application.id),
    title: 'Continue Building Warrant preparation',
    description: 'Internal practice target for completing missing Building Warrant details and preflight checks.',
    targetKey: WorkflowTargetKey.BUILDING_WARRANT_ACTION,
    occurredAt: effect.lifecycleEvent.occurredAt,
    reopen: true,
  });
  await syncDeadline(effect, reopened, calendarSync);
};

export const PHASE_2_EFFECT_HANDLERS: Partial<Record<LifecycleHandlerKey, EffectHandler>> = {
  'project.action.document-review-completed': documentReviewAction,
  'project.activity.document-review-completed': documentReviewActivity,
  'project.deadline.document-review-completed': documentReviewDeadline,
  'planning.action.ready': planningReadyAction,
  'planning.activity.ready': planningReadyActivity,
  'planning.deadline.ready': planningReadyDeadline,
  'planning.action.readiness-revoked': planningReadinessRevokedAction,
  'planning.deadline.readiness-revoked': planningReadinessRevokedDeadline,
  'planning.action.submitted': planningSubmittedAction,
  'planning.activity.submitted': planningSubmittedActivity,
  'planning.deadline.submitted': planningSubmittedDeadline,
  'planning.activity.validated': planningValidatedActivity,
  'planning.action.information-requested': planningInformationRequestedAction,
  'planning.activity.information-requested': planningInformationRequestedActivity,
  'planning.action.approved': planningApprovedAction,
  'planning.activity.approved': planningApprovedActivity,
  'planning.deadline.approved': planningApprovedDeadline,
  'planning.stage.approved': planningApprovedStage,
  'warrant.activity.activated-after-planning': warrantActivatedAfterPlanningActivity,
  'warrant.action.ready': warrantReadyAction,
  'warrant.activity.ready': warrantReadyActivity,
  'warrant.deadline.ready': warrantReadyDeadline,
  'warrant.action.readiness-revoked': warrantReadinessRevokedAction,
  'warrant.deadline.readiness-revoked': warrantReadinessRevokedDeadline,
};
