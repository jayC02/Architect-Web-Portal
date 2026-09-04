import {
  ActionItemStatus,
  AutomationJobStatus,
  AutomationJobType,
  DeadlineManagedBy,
  DeadlineStatus,
  PlanningStatus,
  WarrantStatus,
} from '@prisma/client';
import { prisma } from '../src/lib/db/prisma';
import { syncDeadlineToGoogleBestEffort } from '../src/lib/integrations/google-calendar';
import {
  desktopAutomationJobSelect,
  selectCurrentAutomationJob,
} from '../src/server/services/desktop-automation-status.service';
import { reconcilePreparedApplicationReview } from '../src/server/services/prepared-application-review.service';
import { workflowActionKeys } from '../src/server/services/phase2-workflow-handlers.service';

const applyChanges = process.argv.includes('--apply');
const activeDeadlineStatuses = new Set<DeadlineStatus>([
  DeadlineStatus.UPCOMING,
  DeadlineStatus.DUE_SOON,
  DeadlineStatus.OVERDUE,
]);
const preparedJobStatuses = new Set<AutomationJobStatus>([
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
const finalReviewSourceKey = /^workflow:(planning|warrant):([^:]+):final-review$/;

const run = async () => {
  const deadlines = await prisma.deadline.findMany({
    where: {
      managedBy: DeadlineManagedBy.WORKFLOW,
      OR: [
        { sourceKey: { startsWith: 'workflow:planning:', endsWith: ':final-review' } },
        { sourceKey: { startsWith: 'workflow:warrant:', endsWith: ':final-review' } },
      ],
    },
    include: {
      planningApplication: { select: { id: true, projectId: true, status: true } },
      buildingWarrantApplication: { select: { id: true, projectId: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const projectIds = [...new Set(deadlines.map((deadline) => deadline.projectId).filter((value): value is string => Boolean(value)))];
  const jobs = projectIds.length
    ? await prisma.automationJob.findMany({
        where: { projectId: { in: projectIds } },
        select: desktopAutomationJobSelect,
        orderBy: { updatedAt: 'desc' },
      })
    : [];

  const report = {
    mode: applyChanges ? 'apply' : 'dry-run',
    scanned: deadlines.length,
    skippedManualOverride: 0,
    skippedInvalidIdentity: 0,
    deadlinesToCancel: 0,
    actionsToOpen: 0,
    actionsToResolve: 0,
    calendarSyncFailures: 0,
    changed: 0,
  };

  for (const deadline of deadlines) {
    const match = deadline.sourceKey?.match(finalReviewSourceKey);
    if (!match) {
      report.skippedInvalidIdentity += 1;
      continue;
    }
    if (deadline.manualOverrideAt) {
      report.skippedManualOverride += 1;
      continue;
    }

    const kind = match[1];
    const sourceApplicationId = match[2];
    const application = kind === 'planning'
      ? deadline.planningApplication
      : deadline.buildingWarrantApplication;
    if (!application || application.id !== sourceApplicationId || !deadline.projectId) {
      report.skippedInvalidIdentity += 1;
      continue;
    }

    const types = kind === 'planning'
      ? [AutomationJobType.HOUSEHOLDER_PLANNING, AutomationJobType.PLANNING_APPLICATION]
      : [AutomationJobType.BUILDING_WARRANT];
    const currentJob = selectCurrentAutomationJob(jobs, {
      projectId: deadline.projectId,
      types,
      applicationId: application.id,
    });
    const applicationIsDraft = kind === 'planning'
      ? draftPlanningStatuses.has(application.status as PlanningStatus)
      : draftWarrantStatuses.has(application.status as WarrantStatus);
    const shouldOpen = applicationIsDraft
      && Boolean(currentJob && preparedJobStatuses.has(currentJob.status));
    const dedupeKey = kind === 'planning'
      ? workflowActionKeys.planningFinalReview(application.id)
      : workflowActionKeys.warrantFinalReview(application.id);
    const existingAction = await prisma.actionItem.findUnique({
      where: {
        organisationId_dedupeKey: {
          organisationId: deadline.organisationId,
          dedupeKey,
        },
      },
      select: { status: true, dueAt: true, title: true },
    });
    const deadlineNeedsCancellation = activeDeadlineStatuses.has(deadline.status);
    const expectedTitle = kind === 'planning'
      ? 'Planning prepared — review and submit'
      : 'Building Warrant prepared — pay, review and submit';
    const actionNeedsOpen = shouldOpen && (
      !existingAction
      || existingAction.status !== ActionItemStatus.OPEN
      || existingAction.dueAt !== null
      || existingAction.title !== expectedTitle
    );
    const actionNeedsResolve = !shouldOpen && existingAction?.status === ActionItemStatus.OPEN;

    if (deadlineNeedsCancellation) report.deadlinesToCancel += 1;
    if (actionNeedsOpen) report.actionsToOpen += 1;
    if (actionNeedsResolve) report.actionsToResolve += 1;
    if (!deadlineNeedsCancellation && !actionNeedsOpen && !actionNeedsResolve) continue;
    if (!applyChanges) continue;

    const now = new Date();
    const outcome = await prisma.$transaction(async (tx) => {
      const cancelled = deadlineNeedsCancellation
        ? await tx.deadline.updateMany({
            where: {
              id: deadline.id,
              organisationId: deadline.organisationId,
              managedBy: DeadlineManagedBy.WORKFLOW,
              manualOverrideAt: null,
              status: { in: [...activeDeadlineStatuses] },
            },
            data: { status: DeadlineStatus.CANCELLED, completedDate: now },
          })
        : { count: 0 };

      if (currentJob) {
        await reconcilePreparedApplicationReview(tx, {
          organisationId: deadline.organisationId,
          job: currentJob,
          occurredAt: now,
        });
      } else {
        await tx.actionItem.updateMany({
          where: {
            organisationId: deadline.organisationId,
            dedupeKey,
            status: ActionItemStatus.OPEN,
          },
          data: { status: ActionItemStatus.RESOLVED, resolvedAt: now },
        });
      }
      return { cancelled: cancelled.count > 0 };
    });

    report.changed += 1;
    if (outcome.cancelled) {
      try {
        const sync = await syncDeadlineToGoogleBestEffort(deadline.organisationId, deadline.id);
        if (sync.attempted && !sync.synced) report.calendarSyncFailures += 1;
      } catch {
        report.calendarSyncFailures += 1;
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
  if (!applyChanges) {
    console.log('Dry run only. Re-run with --apply after reviewing this report.');
  }
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
