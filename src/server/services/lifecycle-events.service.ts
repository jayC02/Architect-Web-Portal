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
] as const;

export type ProjectCreatedHandlerKey = typeof PROJECT_CREATED_HANDLER_KEYS[number];

type ProjectCreatedEventInput = {
  organisationId: string;
  project: Pick<Project, 'id' | 'name' | 'createdAt'>;
  source: LifecycleEventSource;
  actorUserId?: string | null;
};

export const projectCreatedIdempotencyKey = (projectId: string) => `project:${projectId}:created`;

export const emitProjectCreatedLifecycleEvent = async (
  tx: Prisma.TransactionClient,
  input: ProjectCreatedEventInput,
) => {
  const project = await tx.project.findFirst({
    where: { id: input.project.id, organisationId: input.organisationId },
    select: { id: true },
  });
  if (!project) throw new Error('Cannot emit PROJECT_CREATED for a project outside the organisation.');

  const idempotencyKey = projectCreatedIdempotencyKey(input.project.id);
  const event = await tx.lifecycleEvent.upsert({
    where: {
      organisationId_idempotencyKey: {
        organisationId: input.organisationId,
        idempotencyKey,
      },
    },
    update: {},
    create: {
      organisationId: input.organisationId,
      projectId: input.project.id,
      aggregateType: LifecycleAggregateType.PROJECT,
      aggregateId: input.project.id,
      eventType: LifecycleEventType.PROJECT_CREATED,
      schemaVersion: 1,
      payload: {
        projectId: input.project.id,
        projectName: input.project.name,
      },
      source: input.source,
      actorType: input.actorUserId ? LifecycleActorType.USER : LifecycleActorType.SYSTEM,
      actorUserId: input.actorUserId ?? null,
      occurredAt: input.project.createdAt,
      idempotencyKey,
    },
  });
  if (
    event.projectId !== input.project.id
    || event.aggregateId !== input.project.id
    || event.eventType !== LifecycleEventType.PROJECT_CREATED
  ) {
    throw new Error('PROJECT_CREATED idempotency key is already bound to another aggregate.');
  }

  await tx.workflowEffect.createMany({
    data: PROJECT_CREATED_HANDLER_KEYS.map((handlerKey) => ({
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

export const expandUndispatchedLifecycleEvents = async (
  tx: Prisma.TransactionClient,
  organisationId: string,
  limit = 50,
) => {
  const events = await tx.lifecycleEvent.findMany({
    where: { organisationId, dispatchedAt: null, eventType: LifecycleEventType.PROJECT_CREATED },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(limit, 100)),
  });
  for (const event of events) {
    await tx.workflowEffect.createMany({
      data: PROJECT_CREATED_HANDLER_KEYS.map((handlerKey) => ({
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
