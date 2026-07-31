import {
  AutomationJobStatus,
  AutomationJobType,
  type Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { buildAutomationJobSnapshot } from '@/server/services/automation-jobs.service';

export const desktopAutomationJobSelect = {
  id: true,
  projectId: true,
  type: true,
  status: true,
  dataSnapshot: true,
  documentSnapshot: true,
  resultSummary: true,
  error: true,
  preparedAt: true,
  claimedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AutomationJobSelect;

export type DesktopAutomationJob = Prisma.AutomationJobGetPayload<{
  select: typeof desktopAutomationJobSelect;
}>;

export const reusableAutomationJobStatuses = [
  AutomationJobStatus.DRAFT,
  AutomationJobStatus.PREFLIGHT_REQUIRED,
  AutomationJobStatus.NEEDS_INPUT,
  AutomationJobStatus.READY,
  AutomationJobStatus.STALE,
  AutomationJobStatus.CLAIMED,
  AutomationJobStatus.IN_PROGRESS,
  AutomationJobStatus.NEEDS_REVIEW,
  AutomationJobStatus.AWAITING_PORTAL_REVIEW,
  AutomationJobStatus.FAILED_RETRYABLE,
  AutomationJobStatus.FAILED,
] as const;

const runningStatuses = new Set<AutomationJobStatus>([
  AutomationJobStatus.CLAIMED,
  AutomationJobStatus.IN_PROGRESS,
]);
const reusableStatuses = new Set<AutomationJobStatus>(reusableAutomationJobStatuses);

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export const automationJobApplicationId = (job: Pick<DesktopAutomationJob, 'type' | 'dataSnapshot'>) => {
  const snapshot = objectValue(job.dataSnapshot);
  if (job.type === AutomationJobType.BUILDING_WARRANT) {
    return stringValue(objectValue(snapshot.buildingWarrant).recordId)
      ?? stringValue(objectValue(snapshot.buildingWarrantApplication).id);
  }
  return stringValue(objectValue(snapshot.planning).recordId)
    ?? stringValue(objectValue(snapshot.planningApplication).id);
};

export const automationJobDocumentCount = (
  job: Pick<DesktopAutomationJob, 'dataSnapshot' | 'documentSnapshot'>,
) => {
  const documentSnapshot = objectValue(job.documentSnapshot);
  if (Array.isArray(documentSnapshot.documents)) return documentSnapshot.documents.length;
  const snapshot = objectValue(job.dataSnapshot);
  return Array.isArray(snapshot.documents) ? snapshot.documents.length : 0;
};

const statusRank = (status: AutomationJobStatus) => {
  if (runningStatuses.has(status)) return 0;
  if (reusableStatuses.has(status)) return 1;
  return 2;
};

const jobTime = (job: DesktopAutomationJob) =>
  (job.claimedAt ?? job.preparedAt ?? job.updatedAt ?? job.createdAt).getTime();

export const selectCurrentAutomationJob = <T extends DesktopAutomationJob>(
  jobs: T[],
  input: {
    projectId: string;
    types: AutomationJobType[];
    applicationId?: string | null;
  },
) => jobs
  .filter((job) => {
    if (job.projectId !== input.projectId || !input.types.includes(job.type)) return false;
    if (!input.applicationId) return true;
    const linkedApplicationId = automationJobApplicationId(job);
    return linkedApplicationId === input.applicationId;
  })
  .sort((left, right) => statusRank(left.status) - statusRank(right.status) || jobTime(right) - jobTime(left))[0] ?? null;

export const findReusableAutomationJob = async (input: {
  organisationId: string;
  projectId: string;
  type: AutomationJobType;
  applicationId?: string | null;
}) => {
  const jobs = await prisma.automationJob.findMany({
    where: {
      organisationId: input.organisationId,
      projectId: input.projectId,
      type: input.type,
      status: { in: [...reusableAutomationJobStatuses] },
    },
    select: desktopAutomationJobSelect,
    orderBy: { updatedAt: 'desc' },
    take: 25,
  });
  return selectCurrentAutomationJob(jobs, {
    projectId: input.projectId,
    types: [input.type],
    applicationId: input.applicationId,
  });
};

export const desktopAutomationPresentation = (status: AutomationJobStatus) => {
  if (status === AutomationJobStatus.READY) {
    return {
      kind: 'ready' as const,
      label: 'Ready to open',
      description: 'The reviewed application is ready for ArchitectPro Desktop.',
      actionLabel: 'Open in desktop',
    };
  }
  if (runningStatuses.has(status)) {
    return {
      kind: 'progress' as const,
      label: 'In progress in desktop',
      description: 'ArchitectPro Desktop has claimed this application and is working through it.',
      actionLabel: 'View status',
    };
  }
  if (status === AutomationJobStatus.COMPLETED) {
    return {
      kind: 'completed' as const,
      label: 'Completed',
      description: 'The desktop workflow has completed this application run.',
      actionLabel: 'View application',
    };
  }
  if (
    status === AutomationJobStatus.FAILED
    || status === AutomationJobStatus.FAILED_RETRYABLE
    || status === AutomationJobStatus.FAILED_FINAL
  ) {
    return {
      kind: 'failed' as const,
      label: 'Could not complete',
      description: 'The desktop run stopped before completion. Review the prepared application before continuing.',
      actionLabel: 'Review issue',
    };
  }
  if (status === AutomationJobStatus.CANCELLED) {
    return {
      kind: 'cancelled' as const,
      label: 'Cancelled',
      description: 'The previous desktop preparation was cancelled.',
      actionLabel: 'Prepare for desktop',
    };
  }
  return {
    kind: 'attention' as const,
    label: 'Needs your attention',
    description: status === AutomationJobStatus.NEEDS_REVIEW || status === AutomationJobStatus.AWAITING_PORTAL_REVIEW
      ? 'The desktop run has reached a point that needs your review.'
      : status === AutomationJobStatus.STALE
        ? 'Project information changed after this application was prepared. Review it before opening in desktop.'
        : 'Review the remaining application details before opening it in desktop.',
    actionLabel: 'Review application',
  };
};

export const getDesktopAutomationContext = async (input: {
  organisationId: string;
  organisationName: string;
  projectId: string;
  type: AutomationJobType;
  matchingTypes?: AutomationJobType[];
  applicationId?: string | null;
  createdBy: { id: string; name: string; email: string };
  jobs?: DesktopAutomationJob[];
}) => {
  const types = input.matchingTypes ?? [input.type];
  const jobs = input.jobs ?? await prisma.automationJob.findMany({
    where: {
      organisationId: input.organisationId,
      projectId: input.projectId,
      type: { in: types },
    },
    select: desktopAutomationJobSelect,
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  const job = selectCurrentAutomationJob(jobs, {
    projectId: input.projectId,
    types,
    applicationId: input.applicationId,
  });
  const canEvaluatePreparation = Boolean(input.applicationId)
    && (!job || job.status === AutomationJobStatus.CANCELLED);
  if (!canEvaluatePreparation) {
    return { job, preparationReady: false, missingCount: 0 };
  }

  try {
    const snapshot = await buildAutomationJobSnapshot({
      organisationId: input.organisationId,
      organisationName: input.organisationName,
      projectId: input.projectId,
      type: input.type,
      createdBy: input.createdBy,
      planningApplicationId: input.type === AutomationJobType.BUILDING_WARRANT
        ? undefined
        : input.applicationId ?? undefined,
      buildingWarrantApplicationId: input.type === AutomationJobType.BUILDING_WARRANT
        ? input.applicationId ?? undefined
        : undefined,
    });
    return {
      job,
      preparationReady: snapshot.preflight.status === 'READY',
      missingCount: snapshot.preflight.missing.length,
    };
  } catch (error) {
    console.error('Unable to evaluate desktop preparation readiness.', error);
    return { job, preparationReady: false, missingCount: 1 };
  }
};
