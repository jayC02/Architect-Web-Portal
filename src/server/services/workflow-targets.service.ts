import { WorkflowTargetKey, type Prisma, type PrismaClient } from '@prisma/client';

export const DEFAULT_PROJECT_DOCUMENT_REVIEW_OFFSET_DAYS = 3;

type WorkflowTargetDatabase = Pick<PrismaClient, 'workflowTarget'> | Pick<Prisma.TransactionClient, 'workflowTarget'>;

export const getProjectDocumentReviewTarget = async (
  database: WorkflowTargetDatabase,
  organisationId: string,
) => {
  const configured = await database.workflowTarget.findUnique({
    where: {
      organisationId_key: {
        organisationId,
        key: WorkflowTargetKey.PROJECT_DOCUMENT_REVIEW,
      },
    },
    select: { enabled: true, offsetDays: true },
  });
  const offsetDays = configured?.offsetDays ?? DEFAULT_PROJECT_DOCUMENT_REVIEW_OFFSET_DAYS;
  if (!Number.isInteger(offsetDays) || offsetDays < 0 || offsetDays > 365) {
    throw new Error('Project document review target must be between 0 and 365 days.');
  }
  return {
    enabled: configured?.enabled ?? true,
    offsetDays,
  };
};

export const calculateWorkflowTargetDate = (occurredAt: Date, offsetDays: number) => {
  const result = new Date(occurredAt);
  result.setUTCDate(result.getUTCDate() + offsetDays);
  return result;
};
