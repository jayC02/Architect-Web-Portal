import {
  DeadlineManagedBy,
  DeadlinePriority,
  DeadlineStatus,
  DeadlineType,
  WorkflowTargetKey,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  calculateWorkflowTargetDate,
  getWorkflowTarget,
} from '@/server/services/workflow-targets.service';

type DeadlineDatabase =
  | Pick<PrismaClient, 'deadline' | 'workflowTarget'>
  | Pick<Prisma.TransactionClient, 'deadline' | 'workflowTarget'>;

export const ensureWorkflowDeadline = async (
  database: DeadlineDatabase,
  input: {
    organisationId: string;
    projectId: string;
    planningApplicationId?: string | null;
    buildingWarrantApplicationId?: string | null;
    sourceKey: string;
    title: string;
    description: string;
    targetKey: WorkflowTargetKey;
    occurredAt: Date;
    reopen?: boolean;
  },
) => {
  const target = await getWorkflowTarget(database, input.organisationId, input.targetKey);
  const existing = await database.deadline.findUnique({
    where: {
      organisationId_sourceKey: {
        organisationId: input.organisationId,
        sourceKey: input.sourceKey,
      },
    },
  });
  if (!target.enabled) {
    if (!existing) return null;
    return database.deadline.update({
      where: { id: existing.id },
      data: {
        status: DeadlineStatus.CANCELLED,
        completedDate: new Date(),
      },
    });
  }
  const calculatedDueDate = calculateWorkflowTargetDate(input.occurredAt, target.offsetDays);
  const dueDate = existing?.manualOverrideAt ? existing.dueDate : calculatedDueDate;
  const preserveTerminalState = existing
    && !input.reopen
    && (existing.status === DeadlineStatus.COMPLETED || existing.status === DeadlineStatus.CANCELLED);
  return database.deadline.upsert({
    where: {
      organisationId_sourceKey: {
        organisationId: input.organisationId,
        sourceKey: input.sourceKey,
      },
    },
    update: {
      projectId: input.projectId,
      planningApplicationId: input.planningApplicationId ?? null,
      buildingWarrantApplicationId: input.buildingWarrantApplicationId ?? null,
      title: input.title,
      description: input.description,
      dueDate,
      calculatedDueDate,
      managedBy: DeadlineManagedBy.WORKFLOW,
      type: DeadlineType.INTERNAL_TASK,
      status: preserveTerminalState ? existing.status : DeadlineStatus.UPCOMING,
      priority: DeadlinePriority.MEDIUM,
      completedDate: preserveTerminalState ? existing.completedDate : null,
    },
    create: {
      organisationId: input.organisationId,
      projectId: input.projectId,
      planningApplicationId: input.planningApplicationId ?? null,
      buildingWarrantApplicationId: input.buildingWarrantApplicationId ?? null,
      title: input.title,
      description: input.description,
      dueDate: calculatedDueDate,
      calculatedDueDate,
      managedBy: DeadlineManagedBy.WORKFLOW,
      type: DeadlineType.INTERNAL_TASK,
      status: DeadlineStatus.UPCOMING,
      priority: DeadlinePriority.MEDIUM,
      sourceKey: input.sourceKey,
    },
  });
};

export const completeWorkflowDeadline = async (
  database: DeadlineDatabase,
  organisationId: string,
  sourceKey: string,
  completedAt: Date,
) => {
  const deadline = await database.deadline.findUnique({
    where: { organisationId_sourceKey: { organisationId, sourceKey } },
  });
  if (!deadline) return null;
  if (deadline.status === DeadlineStatus.COMPLETED) return deadline;
  return database.deadline.update({
    where: { id: deadline.id },
    data: { status: DeadlineStatus.COMPLETED, completedDate: completedAt },
  });
};

export const applyManualWorkflowDeadlineOverride = async (
  tx: Prisma.TransactionClient,
  input: {
    organisationId: string;
    deadlineId: string;
    dueDate: Date;
    actorUserId: string;
    updatedData: Prisma.DeadlineUncheckedUpdateInput;
  },
) => {
  const existing = await tx.deadline.findFirst({
    where: { id: input.deadlineId, organisationId: input.organisationId },
  });
  if (!existing) return null;
  const overridden = existing.managedBy === DeadlineManagedBy.WORKFLOW
    && existing.dueDate.getTime() !== input.dueDate.getTime();
  const manualOverrideAt = overridden ? new Date() : existing.manualOverrideAt;
  const deadline = await tx.deadline.update({
    where: { id: existing.id },
    data: {
      ...input.updatedData,
      dueDate: input.dueDate,
      ...(overridden ? {
        manualOverrideAt,
        manualOverrideById: input.actorUserId,
      } : {}),
    },
  });
  return { deadline, overridden, manualOverrideAt };
};

export const resetWorkflowDeadlineToCalculated = async (
  tx: Prisma.TransactionClient,
  organisationId: string,
  deadlineId: string,
) => {
  const existing = await tx.deadline.findFirst({
    where: {
      id: deadlineId,
      organisationId,
      managedBy: DeadlineManagedBy.WORKFLOW,
      calculatedDueDate: { not: null },
    },
  });
  if (!existing?.calculatedDueDate) return null;
  return tx.deadline.update({
    where: { id: existing.id },
    data: {
      dueDate: existing.calculatedDueDate,
      manualOverrideAt: null,
      manualOverrideById: null,
    },
  });
};
