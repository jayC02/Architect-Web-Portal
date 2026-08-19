import {
  AutomationJobStatus,
  AutomationJobType,
  LifecycleEventSource,
  LifecycleEventType,
  PlanningStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';
import {
  emitBuildingWarrantReadyLifecycleEvent,
  emitPlanningLifecycleEvent,
} from '@/server/services/lifecycle-events.service';
import { drainWorkflowEffectsBestEffort } from '@/server/services/workflow-effects.service';

type PlanningLifecycleSource = Extract<LifecycleEventSource, 'APPLICATION_PREFLIGHT' | 'APPLICATION_STATUS' | 'GMAIL'>;
type PlanningLifecycleEventType = Extract<LifecycleEventType,
  | 'PLANNING_SUBMITTED'
  | 'PLANNING_VALIDATED'
  | 'PLANNING_INFORMATION_REQUESTED'
  | 'PLANNING_APPROVED'>;

export const drainLifecycleEventsBestEffort = async (
  organisationId: string,
  lifecycleEventIds: Array<string | null | undefined>,
) => {
  for (const lifecycleEventId of lifecycleEventIds.filter((value): value is string => Boolean(value))) {
    await drainWorkflowEffectsBestEffort({ organisationId, lifecycleEventId });
  }
};

export const updatePlanningApplicationWithLifecycle = async (
  input: {
    organisationId: string;
    planningApplicationId: string;
    actorUserId?: string | null;
    data: Prisma.PlanningApplicationUncheckedUpdateInput & { status?: PlanningStatus };
    source?: PlanningLifecycleSource;
    occurredAt?: Date;
    evidence?: Prisma.InputJsonObject;
  },
  database: PrismaClient = prisma,
) => {
  const result = await database.$transaction((tx) => updatePlanningApplicationInTransaction(tx, input));
  await drainLifecycleEventsBestEffort(input.organisationId, result.lifecycleEventIds);
  return result.application;
};

export const updatePlanningApplicationInTransaction = async (
  tx: Prisma.TransactionClient,
  input: {
    organisationId: string;
    planningApplicationId: string;
    actorUserId?: string | null;
    data: Prisma.PlanningApplicationUncheckedUpdateInput & { status?: PlanningStatus };
    source?: PlanningLifecycleSource;
    occurredAt?: Date;
    evidence?: Prisma.InputJsonObject;
  },
) => {
    const existing = await tx.planningApplication.findFirst({
      where: { id: input.planningApplicationId, organisationId: input.organisationId },
      select: { id: true, projectId: true, status: true },
    });
    if (!existing) throw new HttpError(404, 'Planning application not found.');
    const application = await tx.planningApplication.update({
      where: { id: existing.id },
      data: input.data,
    });
    const lifecycleEventIds: string[] = [];
    const eventType: PlanningLifecycleEventType | undefined = application.status !== existing.status
      ? ({
          [PlanningStatus.SUBMITTED]: LifecycleEventType.PLANNING_SUBMITTED,
          [PlanningStatus.VALIDATED]: LifecycleEventType.PLANNING_VALIDATED,
          [PlanningStatus.FURTHER_INFORMATION_REQUESTED]: LifecycleEventType.PLANNING_INFORMATION_REQUESTED,
          [PlanningStatus.APPROVED]: LifecycleEventType.PLANNING_APPROVED,
        } as Partial<Record<PlanningStatus, PlanningLifecycleEventType>>)[application.status]
      : undefined;
    if (eventType) {
      lifecycleEventIds.push((await emitPlanningLifecycleEvent(tx, {
        organisationId: input.organisationId,
        projectId: existing.projectId,
        planningApplicationId: existing.id,
        eventType,
        source: input.source ?? LifecycleEventSource.APPLICATION_STATUS,
        actorUserId: input.actorUserId,
        occurredAt: input.occurredAt,
        evidence: input.evidence,
      })).id);
    }
    return { application, lifecycleEventIds };
};

export const recordAutomationReadinessTransition = async (
  tx: Prisma.TransactionClient,
  input: {
    organisationId: string;
    projectId: string;
    jobType: AutomationJobType;
    previousStatus: AutomationJobStatus | null;
    nextStatus: AutomationJobStatus;
    readinessKey: string;
    planningApplicationId?: string | null;
    buildingWarrantApplicationId?: string | null;
    actorUserId?: string | null;
  },
) => {
  const becameReady = input.nextStatus === AutomationJobStatus.READY
    && input.previousStatus !== AutomationJobStatus.READY;
  const readinessRevoked = input.nextStatus !== AutomationJobStatus.READY
    && input.previousStatus === AutomationJobStatus.READY;
  if (!becameReady && !readinessRevoked) return null;

  if (input.jobType === AutomationJobType.BUILDING_WARRANT) {
    if (!input.buildingWarrantApplicationId) {
      throw new Error('Building Warrant readiness requires an application record.');
    }
    const application = await tx.buildingWarrantApplication.findFirst({
      where: {
        id: input.buildingWarrantApplicationId,
        organisationId: input.organisationId,
        projectId: input.projectId,
      },
      select: { id: true },
    });
    if (!application) throw new Error('Building Warrant readiness application is outside the organisation.');
    return emitBuildingWarrantReadyLifecycleEvent(tx, {
      organisationId: input.organisationId,
      projectId: input.projectId,
      buildingWarrantApplicationId: application.id,
      actorUserId: input.actorUserId,
      readinessKey: input.readinessKey,
      revoked: readinessRevoked,
    });
  }

  if (!input.planningApplicationId) {
    throw new Error('Planning readiness requires an application record.');
  }
  const application = await tx.planningApplication.findFirst({
    where: {
      id: input.planningApplicationId,
      organisationId: input.organisationId,
      projectId: input.projectId,
    },
    select: { id: true },
  });
  if (!application) throw new Error('Planning readiness application is outside the organisation.');
  return emitPlanningLifecycleEvent(tx, {
    organisationId: input.organisationId,
    projectId: input.projectId,
    planningApplicationId: application.id,
    eventType: readinessRevoked
      ? LifecycleEventType.PLANNING_READINESS_REVOKED
      : LifecycleEventType.PLANNING_READY,
    source: LifecycleEventSource.APPLICATION_PREFLIGHT,
    actorUserId: input.actorUserId,
    readinessKey: input.readinessKey,
  });
};
