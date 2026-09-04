import {
  ActionItemKind,
  ActionItemPriority,
  ActionItemStatus,
  AutomationJobStatus,
  AutomationJobType,
  PlanningStatus,
  WarrantStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  resolveAutomationJobIdentity,
  type DesktopAutomationJob,
} from '@/server/services/desktop-automation-status.service';
import { workflowActionKeys } from '@/server/services/phase2-workflow-handlers.service';

type PreparedReviewDatabase = Pick<
  PrismaClient | Prisma.TransactionClient,
  'actionItem' | 'planningApplication' | 'buildingWarrantApplication'
>;

type PreparedReviewJob = Pick<
  DesktopAutomationJob,
  'id' | 'projectId' | 'type' | 'status' | 'dataSnapshot'
>;

const preparedStatuses = new Set<AutomationJobStatus>([
  AutomationJobStatus.AWAITING_PORTAL_REVIEW,
  AutomationJobStatus.COMPLETED,
]);

const draftPlanningStatuses = new Set<PlanningStatus>([
  PlanningStatus.NOT_STARTED,
  PlanningStatus.DRAFTING,
]);

const draftWarrantStatuses = new Set<WarrantStatus>([
  WarrantStatus.NOT_STARTED,
  WarrantStatus.DRAFTING,
]);

export type PreparedReviewProjectionResult =
  | { outcome: 'opened' | 'resolved'; applicationId: string }
  | { outcome: 'identity-unavailable' | 'application-unavailable'; applicationId?: string };

export const reconcilePreparedApplicationReview = async (
  database: PreparedReviewDatabase,
  input: {
    organisationId: string;
    job: PreparedReviewJob;
    occurredAt: Date;
  },
): Promise<PreparedReviewProjectionResult> => {
  let identity;
  try {
    identity = resolveAutomationJobIdentity(input.job);
  } catch {
    return { outcome: 'identity-unavailable' };
  }

  const isWarrant = identity.applicationType === AutomationJobType.BUILDING_WARRANT;
  const application = isWarrant
    ? await database.buildingWarrantApplication.findFirst({
        where: {
          id: identity.applicationId,
          organisationId: input.organisationId,
          projectId: identity.projectId,
        },
        select: { id: true, status: true },
      })
    : await database.planningApplication.findFirst({
        where: {
          id: identity.applicationId,
          organisationId: input.organisationId,
          projectId: identity.projectId,
        },
        select: { id: true, status: true },
      });

  if (!application) {
    return { outcome: 'application-unavailable', applicationId: identity.applicationId };
  }

  const dedupeKey = isWarrant
    ? workflowActionKeys.warrantFinalReview(application.id)
    : workflowActionKeys.planningFinalReview(application.id);
  const applicationIsDraft = isWarrant
    ? draftWarrantStatuses.has(application.status as WarrantStatus)
    : draftPlanningStatuses.has(application.status as PlanningStatus);
  const shouldOpen = applicationIsDraft && preparedStatuses.has(input.job.status);

  if (!shouldOpen) {
    await database.actionItem.updateMany({
      where: {
        organisationId: input.organisationId,
        dedupeKey,
        status: ActionItemStatus.OPEN,
      },
      data: { status: ActionItemStatus.RESOLVED, resolvedAt: input.occurredAt },
    });
    return { outcome: 'resolved', applicationId: application.id };
  }

  const kind = isWarrant
    ? ActionItemKind.BUILDING_WARRANT_FINAL_REVIEW
    : ActionItemKind.PLANNING_FINAL_REVIEW;
  const title = isWarrant
    ? 'Building Warrant prepared — pay, review and submit'
    : 'Planning prepared — review and submit';
  const summary = isWarrant
    ? 'Architect Pro prepared the portal draft. Complete payment, review and submit it in eBuilding Standards.'
    : 'Architect Pro prepared the portal draft. Review and submit it in ePlanning.';
  const actionUrl = `/projects/${identity.projectId}#${isWarrant ? 'building-warrant' : 'planning'}`;

  await database.actionItem.upsert({
    where: {
      organisationId_dedupeKey: {
        organisationId: input.organisationId,
        dedupeKey,
      },
    },
    update: {
      projectId: identity.projectId,
      sourceLifecycleEventId: null,
      kind,
      title,
      summary,
      actionUrl,
      priority: ActionItemPriority.MEDIUM,
      status: ActionItemStatus.OPEN,
      availableAt: input.occurredAt,
      dueAt: null,
      resolvedAt: null,
    },
    create: {
      organisationId: input.organisationId,
      projectId: identity.projectId,
      sourceLifecycleEventId: null,
      kind,
      title,
      summary,
      actionUrl,
      priority: ActionItemPriority.MEDIUM,
      status: ActionItemStatus.OPEN,
      availableAt: input.occurredAt,
      dueAt: null,
      dedupeKey,
    },
  });

  return { outcome: 'opened', applicationId: application.id };
};
