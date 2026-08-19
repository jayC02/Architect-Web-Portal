import { WorkflowTargetKey, type Prisma, type PrismaClient } from '@prisma/client';

export const WORKFLOW_TARGET_DEFINITIONS = [
  {
    key: WorkflowTargetKey.PROJECT_DOCUMENT_REVIEW,
    label: 'Document review',
    description: 'Review the project documents and confirm the next application details.',
    defaultOffsetDays: 0,
  },
  {
    key: WorkflowTargetKey.PLANNING_PREPARATION,
    label: 'Planning preparation',
    description: 'Complete the Planning application details and preflight checks.',
    defaultOffsetDays: 0,
  },
  {
    key: WorkflowTargetKey.PLANNING_FINAL_REVIEW,
    label: 'Planning final review',
    description: 'Carry out the final review and run the prepared Planning application.',
    defaultOffsetDays: 0,
  },
  {
    key: WorkflowTargetKey.BUILDING_WARRANT_ACTION,
    label: 'Building Warrant after Planning approval',
    description: 'Continue the existing Building Warrant application after Planning approval.',
    defaultOffsetDays: 0,
  },
  {
    key: WorkflowTargetKey.BUILDING_WARRANT_FINAL_REVIEW,
    label: 'Building Warrant final review',
    description: 'Carry out the final review and run the prepared Building Warrant application.',
    defaultOffsetDays: 0,
  },
] as const;

export const WORKFLOW_TARGET_DEFAULTS = Object.fromEntries(
  WORKFLOW_TARGET_DEFINITIONS.map((definition) => [definition.key, definition.defaultOffsetDays]),
) as Record<WorkflowTargetKey, number>;

export const DEFAULT_PROJECT_DOCUMENT_REVIEW_OFFSET_DAYS =
  WORKFLOW_TARGET_DEFAULTS[WorkflowTargetKey.PROJECT_DOCUMENT_REVIEW];

type WorkflowTargetDatabase =
  | Pick<PrismaClient, 'workflowTarget'>
  | Pick<Prisma.TransactionClient, 'workflowTarget'>;

const validateOffsetDays = (offsetDays: number) => {
  if (!Number.isInteger(offsetDays) || offsetDays < 0 || offsetDays > 365) {
    throw new Error('Workflow target must be between 0 and 365 days.');
  }
  return offsetDays;
};

export const getWorkflowTarget = async (
  database: WorkflowTargetDatabase,
  organisationId: string,
  key: WorkflowTargetKey,
) => {
  const configured = await database.workflowTarget.findUnique({
    where: { organisationId_key: { organisationId, key } },
    select: { enabled: true, offsetDays: true },
  });
  return {
    key,
    enabled: configured?.enabled ?? true,
    offsetDays: validateOffsetDays(configured?.offsetDays ?? WORKFLOW_TARGET_DEFAULTS[key]),
  };
};

export const getWorkflowTargets = async (
  database: WorkflowTargetDatabase,
  organisationId: string,
) => Promise.all(WORKFLOW_TARGET_DEFINITIONS.map(async (definition) => ({
  ...definition,
  ...await getWorkflowTarget(database, organisationId, definition.key),
})));

export const saveWorkflowTargets = async (
  database: WorkflowTargetDatabase,
  organisationId: string,
  targets: Array<{ key: WorkflowTargetKey; enabled: boolean; offsetDays: number }>,
) => {
  const expected = new Set(WORKFLOW_TARGET_DEFINITIONS.map((definition) => definition.key));
  if (targets.length !== expected.size || targets.some((target) => !expected.delete(target.key)) || expected.size) {
    throw new Error('Provide each controlled workflow target exactly once.');
  }
  await Promise.all(targets.map((target) => database.workflowTarget.upsert({
    where: { organisationId_key: { organisationId, key: target.key } },
    create: {
      organisationId,
      key: target.key,
      enabled: target.enabled,
      offsetDays: validateOffsetDays(target.offsetDays),
    },
    update: {
      enabled: target.enabled,
      offsetDays: validateOffsetDays(target.offsetDays),
    },
  })));
  return getWorkflowTargets(database, organisationId);
};

export const getProjectDocumentReviewTarget = async (
  database: WorkflowTargetDatabase,
  organisationId: string,
) => {
  const { enabled, offsetDays } = await getWorkflowTarget(
    database,
    organisationId,
    WorkflowTargetKey.PROJECT_DOCUMENT_REVIEW,
  );
  return { enabled, offsetDays };
};

// No organisation timezone setting exists yet. Use UTC calendar-day arithmetic,
// matching the existing all-day Google Calendar integration.
export const calculateWorkflowTargetDate = (occurredAt: Date, offsetDays: number) => {
  const result = new Date(occurredAt);
  result.setUTCDate(result.getUTCDate() + validateOffsetDays(offsetDays));
  return result;
};
