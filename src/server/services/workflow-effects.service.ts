import { randomUUID } from 'node:crypto';
import {
  ActionItemKind,
  ActionItemPriority,
  ActionItemStatus,
  LifecycleEventType,
  Prisma,
  ProjectActivityEventType,
  ProjectActivityVisibility,
  WorkflowEffectStatus,
  WorkflowTargetKey,
  type PrismaClient,
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { syncDeadlineToGoogleBestEffort } from '@/lib/integrations/google-calendar';
import {
  LIFECYCLE_EVENT_HANDLER_KEYS,
  PROJECT_CREATED_HANDLER_KEYS,
  type LifecycleHandlerKey,
  type ProjectCreatedHandlerKey,
} from '@/server/services/lifecycle-events.service';
import { PHASE_2_EFFECT_HANDLERS, workflowSourceKeys } from '@/server/services/phase2-workflow-handlers.service';
import type { EffectHandler, EffectWithEvent } from '@/server/services/workflow-effect-types';
import { ensureWorkflowDeadline } from '@/server/services/workflow-deadlines.service';
import {
  PermanentWorkflowEffectError,
  RetryableWorkflowEffectError,
} from '@/server/services/workflow-effect-errors';
import {
  calculateWorkflowTargetDate,
  getProjectDocumentReviewTarget,
} from '@/server/services/workflow-targets.service';
import { makeFeeMilestonesEligible } from '@/server/services/xero-draft-invoices.service';

const MAX_EFFECT_ATTEMPTS = 6;
const EFFECT_LEASE_MS = 2 * 60 * 1000;
const projectCreatedPayloadSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1).max(300),
}).strict();

export { PermanentWorkflowEffectError, RetryableWorkflowEffectError };

const loadProjectCreatedContext = async (effect: EffectWithEvent, database: PrismaClient) => {
  if (effect.lifecycleEvent.eventType !== LifecycleEventType.PROJECT_CREATED) {
    throw new PermanentWorkflowEffectError(`Unsupported lifecycle event: ${effect.lifecycleEvent.eventType}`);
  }
  const parsed = projectCreatedPayloadSchema.safeParse(effect.lifecycleEvent.payload);
  if (!parsed.success) throw new PermanentWorkflowEffectError('Malformed PROJECT_CREATED payload.');
  if (
    parsed.data.projectId !== effect.lifecycleEvent.projectId
    || parsed.data.projectId !== effect.lifecycleEvent.aggregateId
    || effect.organisationId !== effect.lifecycleEvent.organisationId
  ) {
    throw new PermanentWorkflowEffectError('PROJECT_CREATED payload does not match its organisation or aggregate.');
  }
  const project = await database.project.findFirst({
    where: { id: parsed.data.projectId, organisationId: effect.organisationId },
    select: { id: true, name: true },
  });
  if (!project) throw new PermanentWorkflowEffectError('PROJECT_CREATED project no longer exists in this organisation.');
  const target = await getProjectDocumentReviewTarget(database, effect.organisationId);
  return {
    project,
    target,
    dueAt: calculateWorkflowTargetDate(effect.lifecycleEvent.occurredAt, target.offsetDays),
  };
};

const ensureInitialDocumentReviewAction: EffectHandler = async (effect, { database }) => {
  const { project, target, dueAt } = await loadProjectCreatedContext(effect, database);
  const dedupeKey = `project:${project.id}:document-review`;
  const existing = await database.actionItem.findUnique({
    where: { organisationId_dedupeKey: { organisationId: effect.organisationId, dedupeKey } },
    select: { status: true, resolvedAt: true },
  });
  const preserveResolved = existing?.status === ActionItemStatus.RESOLVED;
  await database.actionItem.upsert({
    where: { organisationId_dedupeKey: { organisationId: effect.organisationId, dedupeKey } },
    update: {
      title: 'Review project documents',
      summary: 'Check the project documents and confirm the next application details.',
      actionUrl: `/projects/${project.id}#documents`,
      priority: ActionItemPriority.MEDIUM,
      status: preserveResolved ? ActionItemStatus.RESOLVED : ActionItemStatus.OPEN,
      availableAt: effect.lifecycleEvent.occurredAt,
      dueAt: target.enabled ? dueAt : null,
      resolvedAt: preserveResolved ? existing.resolvedAt : null,
    },
    create: {
      organisationId: effect.organisationId,
      projectId: project.id,
      sourceLifecycleEventId: effect.lifecycleEvent.id,
      kind: ActionItemKind.DOCUMENT_REVIEW,
      title: 'Review project documents',
      summary: 'Check the project documents and confirm the next application details.',
      actionUrl: `/projects/${project.id}#documents`,
      priority: ActionItemPriority.MEDIUM,
      status: ActionItemStatus.OPEN,
      availableAt: effect.lifecycleEvent.occurredAt,
      dueAt: target.enabled ? dueAt : null,
      dedupeKey,
    },
  });
};

const ensureProjectCreatedActivity: EffectHandler = async (effect, { database }) => {
  const { project } = await loadProjectCreatedContext(effect, database);
  const idempotencyKey = `project:${project.id}:activity:created`;
  await database.projectActivity.upsert({
    where: { organisationId_idempotencyKey: { organisationId: effect.organisationId, idempotencyKey } },
    update: {},
    create: {
      organisationId: effect.organisationId,
      projectId: project.id,
      sourceLifecycleEventId: effect.lifecycleEvent.id,
      eventType: ProjectActivityEventType.PROJECT_CREATED,
      summary: 'Project created',
      actorType: effect.lifecycleEvent.actorType,
      actorUserId: effect.lifecycleEvent.actorUserId,
      sourceType: 'LIFECYCLE_EVENT',
      sourceId: effect.lifecycleEvent.id,
      visibility: ProjectActivityVisibility.STANDARD,
      occurredAt: effect.lifecycleEvent.occurredAt,
      idempotencyKey,
    },
  });
};

const ensureInternalDocumentReviewDeadline: EffectHandler = async (effect, { database, calendarSync }) => {
  const { project } = await loadProjectCreatedContext(effect, database);
  const deadline = await ensureWorkflowDeadline(database, {
    organisationId: effect.organisationId,
    projectId: project.id,
    sourceKey: workflowSourceKeys.documentReview(project.id),
    title: 'Review project documents',
    description: 'Internal practice target for checking the project documents and next application details.',
    targetKey: WorkflowTargetKey.PROJECT_DOCUMENT_REVIEW,
    occurredAt: effect.lifecycleEvent.occurredAt,
  });
  if (!deadline) return;
  const calendar = await calendarSync(effect.organisationId, deadline.id);
  if (calendar.attempted && !calendar.synced) {
    throw new RetryableWorkflowEffectError('Google Calendar could not sync the internal project deadline.');
  }
};

export const PROJECT_CREATED_EFFECT_HANDLERS: Record<ProjectCreatedHandlerKey, EffectHandler> = {
  'project.action.initial-document-review': ensureInitialDocumentReviewAction,
  'project.activity.created': ensureProjectCreatedActivity,
  'project.deadline.document-review': ensureInternalDocumentReviewDeadline,
};

export const LIFECYCLE_EFFECT_HANDLERS: Record<LifecycleHandlerKey, EffectHandler> = {
  ...PROJECT_CREATED_EFFECT_HANDLERS,
  ...PHASE_2_EFFECT_HANDLERS,
  'finance.fee-milestone.evaluate': async (effect, { database }) => {
    await makeFeeMilestonesEligible(database, effect.lifecycleEvent);
  },
} as Record<LifecycleHandlerKey, EffectHandler>;

const CONTROLLED_HANDLER_KEYS = new Set<LifecycleHandlerKey>(
  Object.values(LIFECYCLE_EVENT_HANDLER_KEYS).flat(),
);

const candidateWhere = (
  now: Date,
  input: { organisationId?: string; lifecycleEventId?: string },
): Prisma.WorkflowEffectWhereInput => ({
  ...(input.organisationId ? { organisationId: input.organisationId } : {}),
  ...(input.lifecycleEventId ? { lifecycleEventId: input.lifecycleEventId } : {}),
  OR: [
    {
      status: { in: [WorkflowEffectStatus.PENDING, WorkflowEffectStatus.RETRYABLE] },
      availableAt: { lte: now },
    },
    {
      status: WorkflowEffectStatus.PROCESSING,
      leaseExpiresAt: { lte: now },
    },
  ],
});

export const claimWorkflowEffects = async (input: {
  organisationId?: string;
  lifecycleEventId?: string;
  limit?: number;
  leaseOwner?: string;
  now?: Date;
  database?: PrismaClient;
}) => {
  const database = input.database ?? prisma;
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 10, 25));
  const leaseOwner = input.leaseOwner ?? randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + EFFECT_LEASE_MS);
  const candidates = await database.workflowEffect.findMany({
    where: candidateWhere(now, input),
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
    take: limit * 3,
    select: { id: true },
  });
  const claimedIds: string[] = [];
  for (const candidate of candidates) {
    if (claimedIds.length >= limit) break;
    const claimed = await database.workflowEffect.updateMany({
      where: { id: candidate.id, ...candidateWhere(now, input) },
      data: {
        status: WorkflowEffectStatus.PROCESSING,
        attempts: { increment: 1 },
        leaseOwner,
        leaseExpiresAt,
        lastError: null,
      },
    });
    if (claimed.count) claimedIds.push(candidate.id);
  }
  if (!claimedIds.length) return [];
  return database.workflowEffect.findMany({
    where: {
      id: { in: claimedIds },
      leaseOwner,
      status: WorkflowEffectStatus.PROCESSING,
      ...(input.organisationId ? { organisationId: input.organisationId } : {}),
    },
    include: { lifecycleEvent: true },
    orderBy: { createdAt: 'asc' },
  });
};

const retryDelayMs = (attempts: number, random: () => number) => {
  const base = Math.min(15_000 * 2 ** Math.max(0, attempts - 1), 60 * 60 * 1000);
  return Math.round(base * (1 + Math.max(0, Math.min(random(), 1)) * 0.2));
};

export const drainWorkflowEffects = async (input: {
  organisationId?: string;
  lifecycleEventId?: string;
  limit?: number;
  leaseOwner?: string;
  now?: Date;
  random?: () => number;
  handlerOverrides?: Partial<Record<LifecycleHandlerKey, EffectHandler>>;
  database?: PrismaClient;
  calendarSync?: typeof syncDeadlineToGoogleBestEffort;
} = {}) => {
  const database = input.database ?? prisma;
  const calendarSync = input.calendarSync ?? syncDeadlineToGoogleBestEffort;
  const now = input.now ?? new Date();
  const random = input.random ?? Math.random;
  const effects = await claimWorkflowEffects({ ...input, now });
  const result = { claimed: effects.length, completed: 0, retryable: 0, failedFinal: 0 };
  for (const effect of effects) {
    const handlerKey = effect.handlerKey as LifecycleHandlerKey;
    const handler = input.handlerOverrides?.[handlerKey] ?? LIFECYCLE_EFFECT_HANDLERS[handlerKey];
    try {
      if (!CONTROLLED_HANDLER_KEYS.has(handlerKey) || !handler) {
        throw new PermanentWorkflowEffectError(`Unknown workflow effect handler: ${effect.handlerKey}`);
      }
      await handler(effect, { database, calendarSync });
      await database.workflowEffect.updateMany({
        where: {
          id: effect.id,
          organisationId: effect.organisationId,
          status: WorkflowEffectStatus.PROCESSING,
          leaseOwner: effect.leaseOwner,
        },
        data: {
          status: WorkflowEffectStatus.COMPLETED,
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      });
      result.completed += 1;
    } catch (error) {
      const permanent = error instanceof PermanentWorkflowEffectError
        || error instanceof z.ZodError
        || effect.attempts >= MAX_EFFECT_ATTEMPTS;
      const message = error instanceof Error ? error.message.slice(0, 1000) : 'Workflow effect failed.';
      await database.workflowEffect.updateMany({
        where: {
          id: effect.id,
          organisationId: effect.organisationId,
          status: WorkflowEffectStatus.PROCESSING,
          leaseOwner: effect.leaseOwner,
        },
        data: permanent ? {
          status: WorkflowEffectStatus.FAILED_FINAL,
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: message,
        } : {
          status: WorkflowEffectStatus.RETRYABLE,
          availableAt: new Date(now.getTime() + retryDelayMs(effect.attempts, random)),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: message,
        },
      });
      if (permanent) result.failedFinal += 1;
      else result.retryable += 1;
    }
  }
  return result;
};

export const drainWorkflowEffectsBestEffort = async (input: {
  organisationId: string;
  lifecycleEventId: string;
}) => {
  try {
    return await drainWorkflowEffects({ ...input, limit: PROJECT_CREATED_HANDLER_KEYS.length });
  } catch (error) {
    console.error('Workflow effect drain failed', { ...input, error });
    return { claimed: 0, completed: 0, retryable: 0, failedFinal: 0 };
  }
};
