import {
  LifecycleActorType,
  LifecycleAggregateType,
  LifecycleEventSource,
  LifecycleEventType,
  Prisma,
  type Project,
} from '@prisma/client';

export const PROJECT_CREATED_HANDLER_KEYS = [
  'project.action.initial-document-review',
  'project.activity.created',
  'project.deadline.document-review',
  'finance.fee-milestone.evaluate',
] as const;

export const DOCUMENT_REVIEW_COMPLETED_HANDLER_KEYS = [
  'project.action.document-review-completed',
  'project.activity.document-review-completed',
  'project.deadline.document-review-completed',
] as const;

export const PLANNING_READY_HANDLER_KEYS = [
  'planning.action.ready',
  'planning.activity.ready',
  'planning.deadline.ready',
] as const;

export const PLANNING_READINESS_REVOKED_HANDLER_KEYS = [
  'planning.action.readiness-revoked',
  'planning.deadline.readiness-revoked',
] as const;

export const PLANNING_SUBMITTED_HANDLER_KEYS = [
  'planning.action.submitted',
  'planning.activity.submitted',
  'planning.deadline.submitted',
  'finance.fee-milestone.evaluate',
] as const;

export const PLANNING_VALIDATED_HANDLER_KEYS = [
  'planning.activity.validated',
] as const;

export const PLANNING_INFORMATION_REQUESTED_HANDLER_KEYS = [
  'planning.action.information-requested',
  'planning.activity.information-requested',
] as const;

export const PLANNING_APPROVED_HANDLER_KEYS = [
  'planning.action.approved',
  'planning.activity.approved',
  'planning.deadline.approved',
  'planning.stage.approved',
  'warrant.activity.activated-after-planning',
  'planning.calendar.decision',
  'finance.fee-milestone.evaluate',
] as const;

export const PLANNING_REFUSED_HANDLER_KEYS = [
  'planning.action.refused',
  'planning.activity.refused',
  'planning.calendar.decision',
] as const;

export const BUILDING_WARRANT_SUBMITTED_HANDLER_KEYS = [
  'finance.fee-milestone.evaluate',
] as const;

export const BUILDING_WARRANT_GRANTED_HANDLER_KEYS = [
  'warrant.action.granted',
  'warrant.activity.granted',
  'warrant.calendar.decision',
] as const;

export const BUILDING_WARRANT_READY_HANDLER_KEYS = [
  'warrant.action.ready',
  'warrant.activity.ready',
  'warrant.deadline.ready',
] as const;

export const BUILDING_WARRANT_READINESS_REVOKED_HANDLER_KEYS = [
  'warrant.action.readiness-revoked',
  'warrant.deadline.readiness-revoked',
] as const;

export type ProjectCreatedHandlerKey = Exclude<typeof PROJECT_CREATED_HANDLER_KEYS[number], 'finance.fee-milestone.evaluate'>;
export type LifecycleHandlerKey =
  | ProjectCreatedHandlerKey
  | typeof DOCUMENT_REVIEW_COMPLETED_HANDLER_KEYS[number]
  | typeof PLANNING_READY_HANDLER_KEYS[number]
  | typeof PLANNING_READINESS_REVOKED_HANDLER_KEYS[number]
  | typeof PLANNING_SUBMITTED_HANDLER_KEYS[number]
  | typeof PLANNING_VALIDATED_HANDLER_KEYS[number]
  | typeof PLANNING_INFORMATION_REQUESTED_HANDLER_KEYS[number]
  | typeof PLANNING_APPROVED_HANDLER_KEYS[number]
  | typeof PLANNING_REFUSED_HANDLER_KEYS[number]
  | typeof BUILDING_WARRANT_READY_HANDLER_KEYS[number]
  | typeof BUILDING_WARRANT_READINESS_REVOKED_HANDLER_KEYS[number]
  | typeof BUILDING_WARRANT_SUBMITTED_HANDLER_KEYS[number]
  | typeof BUILDING_WARRANT_GRANTED_HANDLER_KEYS[number];

export const LIFECYCLE_EVENT_HANDLER_KEYS: Record<LifecycleEventType, readonly LifecycleHandlerKey[]> = {
  [LifecycleEventType.PROJECT_CREATED]: PROJECT_CREATED_HANDLER_KEYS,
  [LifecycleEventType.DOCUMENT_REVIEW_COMPLETED]: DOCUMENT_REVIEW_COMPLETED_HANDLER_KEYS,
  [LifecycleEventType.PLANNING_READY]: PLANNING_READY_HANDLER_KEYS,
  [LifecycleEventType.PLANNING_READINESS_REVOKED]: PLANNING_READINESS_REVOKED_HANDLER_KEYS,
  [LifecycleEventType.PLANNING_SUBMITTED]: PLANNING_SUBMITTED_HANDLER_KEYS,
  [LifecycleEventType.PLANNING_VALIDATED]: PLANNING_VALIDATED_HANDLER_KEYS,
  [LifecycleEventType.PLANNING_INFORMATION_REQUESTED]: PLANNING_INFORMATION_REQUESTED_HANDLER_KEYS,
  [LifecycleEventType.PLANNING_APPROVED]: PLANNING_APPROVED_HANDLER_KEYS,
  [LifecycleEventType.PLANNING_REFUSED]: PLANNING_REFUSED_HANDLER_KEYS,
  [LifecycleEventType.BUILDING_WARRANT_READY]: BUILDING_WARRANT_READY_HANDLER_KEYS,
  [LifecycleEventType.BUILDING_WARRANT_READINESS_REVOKED]: BUILDING_WARRANT_READINESS_REVOKED_HANDLER_KEYS,
  [LifecycleEventType.BUILDING_WARRANT_SUBMITTED]: BUILDING_WARRANT_SUBMITTED_HANDLER_KEYS,
  [LifecycleEventType.BUILDING_WARRANT_GRANTED]: BUILDING_WARRANT_GRANTED_HANDLER_KEYS,
};

type ProjectCreatedEventInput = {
  organisationId: string;
  project: Pick<Project, 'id' | 'name' | 'createdAt'>;
  source: LifecycleEventSource;
  actorUserId?: string | null;
};

export const projectCreatedIdempotencyKey = (projectId: string) => `project:${projectId}:created`;

type LifecycleEventInput = {
  organisationId: string;
  projectId: string;
  aggregateType: LifecycleAggregateType;
  aggregateId: string;
  eventType: LifecycleEventType;
  payload: Prisma.InputJsonObject;
  source: LifecycleEventSource;
  actorUserId?: string | null;
  occurredAt: Date;
  idempotencyKey: string;
};

const emitLifecycleEvent = async (tx: Prisma.TransactionClient, input: LifecycleEventInput) => {
  const project = await tx.project.findFirst({
    where: { id: input.projectId, organisationId: input.organisationId },
    select: { id: true },
  });
  if (!project) throw new Error(`Cannot emit ${input.eventType} for a project outside the organisation.`);
  const event = await tx.lifecycleEvent.upsert({
    where: {
      organisationId_idempotencyKey: {
        organisationId: input.organisationId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    update: {},
    create: {
      organisationId: input.organisationId,
      projectId: input.projectId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      schemaVersion: 1,
      payload: input.payload,
      source: input.source,
      actorType: input.actorUserId ? LifecycleActorType.USER : LifecycleActorType.SYSTEM,
      actorUserId: input.actorUserId ?? null,
      occurredAt: input.occurredAt,
      idempotencyKey: input.idempotencyKey,
    },
  });
  if (
    event.projectId !== input.projectId
    || event.aggregateType !== input.aggregateType
    || event.aggregateId !== input.aggregateId
    || event.eventType !== input.eventType
  ) {
    throw new Error(`${input.eventType} idempotency key is already bound to another aggregate.`);
  }
  const handlerKeys = LIFECYCLE_EVENT_HANDLER_KEYS[input.eventType];
  await tx.workflowEffect.createMany({
    data: handlerKeys.map((handlerKey) => ({
      organisationId: input.organisationId,
      lifecycleEventId: event.id,
      handlerKey,
    })),
    skipDuplicates: true,
  });
  await tx.lifecycleEvent.update({
    where: { id: event.id },
    data: { dispatchedAt: event.dispatchedAt ?? new Date() },
  });
  return event;
};

export const emitProjectCreatedLifecycleEvent = async (
  tx: Prisma.TransactionClient,
  input: ProjectCreatedEventInput,
) => {
  const idempotencyKey = projectCreatedIdempotencyKey(input.project.id);
  return emitLifecycleEvent(tx, {
    organisationId: input.organisationId,
    projectId: input.project.id,
    aggregateType: LifecycleAggregateType.PROJECT,
    aggregateId: input.project.id,
    eventType: LifecycleEventType.PROJECT_CREATED,
    payload: { projectId: input.project.id, projectName: input.project.name },
    source: input.source,
    actorUserId: input.actorUserId,
    occurredAt: input.project.createdAt,
    idempotencyKey,
  });
};

export const emitDocumentReviewCompletedLifecycleEvent = (
  tx: Prisma.TransactionClient,
  input: {
    organisationId: string;
    projectId: string;
    applicationDraftId: string;
    planningApplicationId?: string | null;
    buildingWarrantApplicationId?: string | null;
    actorUserId: string;
    occurredAt?: Date;
  },
) => emitLifecycleEvent(tx, {
  organisationId: input.organisationId,
  projectId: input.projectId,
  aggregateType: LifecycleAggregateType.PROJECT,
  aggregateId: input.projectId,
  eventType: LifecycleEventType.DOCUMENT_REVIEW_COMPLETED,
  payload: {
    projectId: input.projectId,
    applicationDraftId: input.applicationDraftId,
    planningApplicationId: input.planningApplicationId ?? null,
    buildingWarrantApplicationId: input.buildingWarrantApplicationId ?? null,
  },
  source: LifecycleEventSource.APPLICATION_DRAFT,
  actorUserId: input.actorUserId,
  occurredAt: input.occurredAt ?? new Date(),
  idempotencyKey: `application-draft:${input.applicationDraftId}:document-review-completed`,
});

export const emitPlanningLifecycleEvent = (
  tx: Prisma.TransactionClient,
  input: {
    organisationId: string;
    projectId: string;
    planningApplicationId: string;
    eventType: Extract<LifecycleEventType,
      | 'PLANNING_READY'
      | 'PLANNING_READINESS_REVOKED'
      | 'PLANNING_SUBMITTED'
      | 'PLANNING_VALIDATED'
      | 'PLANNING_INFORMATION_REQUESTED'
      | 'PLANNING_APPROVED'
      | 'PLANNING_REFUSED'>;
    source: Extract<LifecycleEventSource, 'APPLICATION_PREFLIGHT' | 'APPLICATION_STATUS' | 'GMAIL'>;
    actorUserId?: string | null;
    occurredAt?: Date;
    readinessKey?: string;
    evidence?: Prisma.InputJsonObject;
  },
) => {
  const suffix = input.eventType === LifecycleEventType.PLANNING_READY
    ? `ready:${input.readinessKey ?? 'initial'}`
    : input.eventType === LifecycleEventType.PLANNING_READINESS_REVOKED
      ? `readiness-revoked:${input.readinessKey ?? 'initial'}`
    : input.eventType === LifecycleEventType.PLANNING_SUBMITTED
      ? 'submitted'
      : input.eventType === LifecycleEventType.PLANNING_VALIDATED
        ? 'validated'
        : input.eventType === LifecycleEventType.PLANNING_INFORMATION_REQUESTED
          ? 'information-requested'
          : input.eventType === LifecycleEventType.PLANNING_REFUSED
            ? 'refused'
            : 'approved';
  return emitLifecycleEvent(tx, {
    organisationId: input.organisationId,
    projectId: input.projectId,
    aggregateType: LifecycleAggregateType.PLANNING_APPLICATION,
    aggregateId: input.planningApplicationId,
    eventType: input.eventType,
    payload: {
      projectId: input.projectId,
      planningApplicationId: input.planningApplicationId,
      ...(input.evidence ?? {}),
    },
    source: input.source,
    actorUserId: input.actorUserId,
    occurredAt: input.occurredAt ?? new Date(),
    idempotencyKey: `planning:${input.planningApplicationId}:${suffix}`,
  });
};

export const emitBuildingWarrantReadyLifecycleEvent = (
  tx: Prisma.TransactionClient,
  input: {
    organisationId: string;
    projectId: string;
    buildingWarrantApplicationId: string;
    actorUserId?: string | null;
    occurredAt?: Date;
    readinessKey: string;
    revoked?: boolean;
  },
) => emitLifecycleEvent(tx, {
  organisationId: input.organisationId,
  projectId: input.projectId,
  aggregateType: LifecycleAggregateType.BUILDING_WARRANT_APPLICATION,
  aggregateId: input.buildingWarrantApplicationId,
  eventType: input.revoked
    ? LifecycleEventType.BUILDING_WARRANT_READINESS_REVOKED
    : LifecycleEventType.BUILDING_WARRANT_READY,
  payload: { projectId: input.projectId, buildingWarrantApplicationId: input.buildingWarrantApplicationId },
  source: LifecycleEventSource.APPLICATION_PREFLIGHT,
  actorUserId: input.actorUserId,
  occurredAt: input.occurredAt ?? new Date(),
  idempotencyKey: `warrant:${input.buildingWarrantApplicationId}:${input.revoked ? 'readiness-revoked' : 'ready'}:${input.readinessKey}`,
});

export const emitBuildingWarrantSubmittedLifecycleEvent = (
  tx: Prisma.TransactionClient,
  input: {
    organisationId: string;
    projectId: string;
    buildingWarrantApplicationId: string;
    actorUserId?: string | null;
    occurredAt?: Date;
  },
) => emitLifecycleEvent(tx, {
  organisationId: input.organisationId,
  projectId: input.projectId,
  aggregateType: LifecycleAggregateType.BUILDING_WARRANT_APPLICATION,
  aggregateId: input.buildingWarrantApplicationId,
  eventType: LifecycleEventType.BUILDING_WARRANT_SUBMITTED,
  payload: { projectId: input.projectId, buildingWarrantApplicationId: input.buildingWarrantApplicationId },
  source: LifecycleEventSource.APPLICATION_STATUS,
  actorUserId: input.actorUserId,
  occurredAt: input.occurredAt ?? new Date(),
  idempotencyKey: `warrant:${input.buildingWarrantApplicationId}:submitted`,
});

export const emitBuildingWarrantGrantedLifecycleEvent = (
  tx: Prisma.TransactionClient,
  input: {
    organisationId: string;
    projectId: string;
    buildingWarrantApplicationId: string;
    actorUserId?: string | null;
    occurredAt?: Date;
    source?: Extract<LifecycleEventSource, 'APPLICATION_STATUS' | 'GMAIL'>;
  },
) => emitLifecycleEvent(tx, {
  organisationId: input.organisationId,
  projectId: input.projectId,
  aggregateType: LifecycleAggregateType.BUILDING_WARRANT_APPLICATION,
  aggregateId: input.buildingWarrantApplicationId,
  eventType: LifecycleEventType.BUILDING_WARRANT_GRANTED,
  payload: { projectId: input.projectId, buildingWarrantApplicationId: input.buildingWarrantApplicationId },
  source: input.source ?? LifecycleEventSource.APPLICATION_STATUS,
  actorUserId: input.actorUserId,
  occurredAt: input.occurredAt ?? new Date(),
  idempotencyKey: `warrant:${input.buildingWarrantApplicationId}:granted`,
});

export const expandUndispatchedLifecycleEvents = async (
  tx: Prisma.TransactionClient,
  organisationId: string,
  limit = 50,
) => {
  const events = await tx.lifecycleEvent.findMany({
    where: { organisationId, dispatchedAt: null },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(limit, 100)),
  });
  for (const event of events) {
    const handlerKeys = LIFECYCLE_EVENT_HANDLER_KEYS[event.eventType];
    await tx.workflowEffect.createMany({
      data: handlerKeys.map((handlerKey) => ({
        organisationId,
        lifecycleEventId: event.id,
        handlerKey,
      })),
      skipDuplicates: true,
    });
    await tx.lifecycleEvent.updateMany({
      where: { id: event.id, organisationId, dispatchedAt: null },
      data: { dispatchedAt: new Date() },
    });
  }
  return events.length;
};
