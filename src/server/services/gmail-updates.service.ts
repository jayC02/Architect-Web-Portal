import crypto from 'node:crypto';
import {
  CompletionCertificateStatus,
  DeadlinePriority,
  DeadlineStatus,
  DeadlineType,
  GmailSuggestionStatus,
  GmailUpdateType,
  LifecycleEventSource,
  PlanningStatus,
  Prisma,
  WarrantStatus,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { syncDeadlineToGoogleBestEffort } from '@/lib/integrations/google-calendar';
import { HttpError } from '@/lib/utils/http';
import {
  drainLifecycleEventsBestEffort,
  updatePlanningApplicationInTransaction,
} from '@/server/services/application-lifecycle.service';
import { resolvePlanningCorrespondenceReviewAction } from '@/server/services/gmail-planning-lifecycle.service';

const planningFields = new Set([
  'applicationReference',
  'submissionDate',
  'validDate',
  'decisionTargetDate',
  'decisionDate',
  'status',
]);
const warrantFields = new Set([
  'warrantReference',
  'submissionDate',
  'firstResponseTargetDate',
  'grantedDate',
  'expiryDate',
  'completionCertificateStatus',
  'status',
]);
const dateFields = new Set([
  'submissionDate',
  'validDate',
  'decisionTargetDate',
  'decisionDate',
  'firstResponseTargetDate',
  'grantedDate',
  'expiryDate',
]);

const jsonValue = (value: unknown): Prisma.InputJsonValue | Prisma.JsonNullValueInput => {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
};

const comparable = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return null;
  return value;
};

export const gmailSuggestionDedupeKey = (input: {
  updateType: string;
  fieldName: string;
  value: unknown;
}) => crypto.createHash('sha256')
  .update(JSON.stringify([input.updateType, input.fieldName, input.value]))
  .digest('base64url');

const validatedDate = (value: unknown) => {
  const result = new Date(String(value));
  if (Number.isNaN(result.getTime())) throw new HttpError(400, 'The suggested date is invalid.');
  return result;
};

const planningData = (fieldName: string, value: unknown): Prisma.PlanningApplicationUncheckedUpdateInput => {
  if (!planningFields.has(fieldName)) throw new HttpError(400, 'This planning update is not supported.');
  if (fieldName === 'status') {
    if (!Object.values(PlanningStatus).includes(value as PlanningStatus)) throw new HttpError(400, 'The suggested planning status is invalid.');
    return { status: value as PlanningStatus };
  }
  if (dateFields.has(fieldName)) return { [fieldName]: validatedDate(value) };
  return { [fieldName]: String(value).slice(0, 120) };
};

const warrantData = (fieldName: string, value: unknown): Prisma.BuildingWarrantApplicationUpdateInput => {
  if (!warrantFields.has(fieldName)) throw new HttpError(400, 'This building warrant update is not supported.');
  if (fieldName === 'status') {
    if (!Object.values(WarrantStatus).includes(value as WarrantStatus)) throw new HttpError(400, 'The suggested warrant status is invalid.');
    return { status: value as WarrantStatus };
  }
  if (fieldName === 'completionCertificateStatus') {
    if (!Object.values(CompletionCertificateStatus).includes(value as CompletionCertificateStatus)) {
      throw new HttpError(400, 'The suggested completion certificate status is invalid.');
    }
    return { completionCertificateStatus: value as CompletionCertificateStatus };
  }
  if (dateFields.has(fieldName)) return { [fieldName]: validatedDate(value) };
  return { [fieldName]: String(value).slice(0, 120) };
};

const currentFieldValue = (record: Record<string, unknown>, fieldName: string) => comparable(record[fieldName]);

const assertNoNewerManualValue = (current: unknown, previous: unknown, suggested: unknown) => {
  const normalCurrent = comparable(current);
  const normalPrevious = comparable(previous);
  const normalSuggested = comparable(suggested);
  if (
    normalCurrent !== null
    && JSON.stringify(normalCurrent) !== JSON.stringify(normalPrevious)
    && JSON.stringify(normalCurrent) !== JSON.stringify(normalSuggested)
  ) {
    throw new HttpError(409, 'This value changed after the email was processed. Review the current application before applying it.');
  }
};

const ensurePlanningApplication = async (organisationId: string, projectId: string, preferredId?: string | null) => {
  if (preferredId) {
    const existing = await prisma.planningApplication.findFirst({ where: { id: preferredId, organisationId, projectId } });
    if (existing) return existing;
  }
  const latest = await prisma.planningApplication.findFirst({
    where: { organisationId, projectId },
    orderBy: { updatedAt: 'desc' },
  });
  if (!latest) throw new HttpError(409, 'No existing Planning application is linked to this email.');
  return latest;
};

const ensureWarrantApplication = async (organisationId: string, projectId: string, preferredId?: string | null) => {
  if (preferredId) {
    const existing = await prisma.buildingWarrantApplication.findFirst({ where: { id: preferredId, organisationId, projectId } });
    if (existing) return existing;
  }
  const latest = await prisma.buildingWarrantApplication.findFirst({
    where: { organisationId, projectId },
    orderBy: { updatedAt: 'desc' },
  });
  if (!latest) throw new HttpError(409, 'No existing Building Warrant is linked to this email.');
  return latest;
};

type ApplySuggestionInput = {
  organisationId: string;
  suggestionId: string;
  reviewedById?: string;
  automatic?: boolean;
  overrideValue?: unknown;
};

export const applyGmailSuggestion = async ({
  organisationId,
  suggestionId,
  reviewedById,
  automatic = false,
  overrideValue,
}: ApplySuggestionInput) => {
  const suggestion = await prisma.gmailUpdateSuggestion.findFirst({
    where: { id: suggestionId, organisationId },
    include: { trackedEmail: true },
  });
  if (!suggestion) throw new HttpError(404, 'Email update not found.');
  if (suggestion.status === GmailSuggestionStatus.APPLIED) return { alreadyApplied: true, deadlineId: null };
  if (suggestion.status !== GmailSuggestionStatus.PENDING) throw new HttpError(409, 'This email update is no longer pending.');
  if (!suggestion.projectId) throw new HttpError(409, 'Link this email to a project before applying updates.');

  const value = overrideValue === undefined ? suggestion.suggestedValue : overrideValue;
  let deadlineId: string | null = null;

  try {
    if (suggestion.updateType === GmailUpdateType.PLANNING_APPLICATION) {
      const application = await ensurePlanningApplication(
        organisationId,
        suggestion.projectId,
        suggestion.planningApplicationId,
      );
      assertNoNewerManualValue(
        currentFieldValue(application as unknown as Record<string, unknown>, suggestion.fieldName),
        suggestion.existingValue,
        value,
      );
      const applied = await prisma.$transaction(async (tx) => {
        const lifecycleEventIds: string[] = [];
        if (suggestion.fieldName === 'status') {
          planningData(suggestion.fieldName, value);
          const transition = await updatePlanningApplicationInTransaction(tx, {
            organisationId,
            planningApplicationId: application.id,
            actorUserId: reviewedById ?? null,
            source: LifecycleEventSource.GMAIL,
            occurredAt: suggestion.trackedEmail.sentAt,
            data: { status: value as PlanningStatus },
            evidence: {
              sourceType: 'GMAIL_REVIEW',
              gmailMessageId: suggestion.trackedEmail.gmailMessageId,
              trackedEmailId: suggestion.trackedEmailId,
            },
          });
          lifecycleEventIds.push(...transition.lifecycleEventIds);
        } else {
          await tx.planningApplication.update({
            where: { id: application.id },
            data: planningData(suggestion.fieldName, value),
          });
        }
        await tx.gmailUpdateSuggestion.update({
          where: { id: suggestion.id },
          data: {
            planningApplicationId: application.id,
            suggestedValue: jsonValue(value),
            status: GmailSuggestionStatus.APPLIED,
            appliedAutomatically: automatic,
            reviewedById: reviewedById ?? null,
            reviewedAt: reviewedById ? new Date() : null,
            appliedAt: new Date(),
            error: null,
          },
        });
        await tx.trackedEmail.update({
          where: { id: suggestion.trackedEmailId },
          data: { planningApplicationId: application.id, processingStatus: 'PROCESSED' },
        });
        return lifecycleEventIds;
      });
      await drainLifecycleEventsBestEffort(organisationId, applied);
      await resolvePlanningCorrespondenceReviewAction(prisma, organisationId, suggestion.trackedEmailId);
    } else if (suggestion.updateType === GmailUpdateType.BUILDING_WARRANT) {
      const application = await ensureWarrantApplication(
        organisationId,
        suggestion.projectId,
        suggestion.buildingWarrantApplicationId,
      );
      assertNoNewerManualValue(
        currentFieldValue(application as unknown as Record<string, unknown>, suggestion.fieldName),
        suggestion.existingValue,
        value,
      );
      await prisma.$transaction([
        prisma.buildingWarrantApplication.update({
          where: { id: application.id },
          data: warrantData(suggestion.fieldName, value),
        }),
        prisma.gmailUpdateSuggestion.update({
          where: { id: suggestion.id },
          data: {
            buildingWarrantApplicationId: application.id,
            suggestedValue: jsonValue(value),
            status: GmailSuggestionStatus.APPLIED,
            appliedAutomatically: automatic,
            reviewedById: reviewedById ?? null,
            reviewedAt: reviewedById ? new Date() : null,
            appliedAt: new Date(),
            error: null,
          },
        }),
        prisma.trackedEmail.update({
          where: { id: suggestion.trackedEmailId },
          data: { buildingWarrantApplicationId: application.id, processingStatus: 'PROCESSED' },
        }),
      ]);
    } else if (suggestion.updateType === GmailUpdateType.DEADLINE) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'The deadline suggestion is invalid.');
      const deadlineValue = value as Record<string, unknown>;
      const dueDate = validatedDate(deadlineValue.dueDate);
      const type = String(deadlineValue.type ?? 'CUSTOM') as DeadlineType;
      if (!Object.values(DeadlineType).includes(type)) throw new HttpError(400, 'The suggested deadline type is invalid.');
      const project = await prisma.project.findFirst({
        where: { id: suggestion.projectId, organisationId },
        select: { id: true, name: true },
      });
      if (!project) throw new HttpError(404, 'Project not found.');
      const sourceKey = `gmail:${suggestion.trackedEmail.gmailThreadId}:${suggestion.projectId}:${suggestion.fieldName}`;
      const existing = await prisma.deadline.findUnique({
        where: { organisationId_sourceKey: { organisationId, sourceKey } },
      });
      assertNoNewerManualValue(existing?.dueDate ?? null, suggestion.existingValue, dueDate.toISOString());
      const deadline = await prisma.deadline.upsert({
        where: { organisationId_sourceKey: { organisationId, sourceKey } },
        update: {
          title: `${String(deadlineValue.title ?? 'Project deadline')} - ${project.name}`.slice(0, 160),
          dueDate,
          type,
          status: DeadlineStatus.UPCOMING,
          projectId: project.id,
          planningApplicationId: suggestion.planningApplicationId,
          buildingWarrantApplicationId: suggestion.buildingWarrantApplicationId,
        },
        create: {
          organisationId,
          projectId: project.id,
          planningApplicationId: suggestion.planningApplicationId,
          buildingWarrantApplicationId: suggestion.buildingWarrantApplicationId,
          title: `${String(deadlineValue.title ?? 'Project deadline')} - ${project.name}`.slice(0, 160),
          description: 'Created from a confirmed project email.',
          dueDate,
          type,
          status: DeadlineStatus.UPCOMING,
          priority: DeadlinePriority.MEDIUM,
          sourceKey,
        },
      });
      deadlineId = deadline.id;
      await prisma.gmailUpdateSuggestion.update({
        where: { id: suggestion.id },
        data: {
          suggestedValue: jsonValue(value),
          status: GmailSuggestionStatus.APPLIED,
          appliedAutomatically: automatic,
          reviewedById: reviewedById ?? null,
          reviewedAt: reviewedById ? new Date() : null,
          appliedAt: new Date(),
          error: null,
        },
      });
      await syncDeadlineToGoogleBestEffort(organisationId, deadline.id);
    } else {
      await prisma.gmailUpdateSuggestion.update({
        where: { id: suggestion.id },
        data: {
          status: GmailSuggestionStatus.APPLIED,
          appliedAutomatically: automatic,
          reviewedById: reviewedById ?? null,
          reviewedAt: reviewedById ? new Date() : null,
          appliedAt: new Date(),
          error: null,
        },
      });
    }
  } catch (error) {
    await prisma.gmailUpdateSuggestion.updateMany({
      where: { id: suggestion.id, organisationId },
      data: { status: GmailSuggestionStatus.FAILED, error: error instanceof Error ? error.message.slice(0, 500) : 'Update failed.' },
    });
    throw error;
  }

  return { alreadyApplied: false, deadlineId };
};

export const rejectGmailSuggestion = async (organisationId: string, suggestionId: string, reviewedById: string) => {
  const result = await prisma.gmailUpdateSuggestion.updateMany({
    where: { id: suggestionId, organisationId, status: GmailSuggestionStatus.PENDING },
    data: {
      status: GmailSuggestionStatus.REJECTED,
      reviewedById,
      reviewedAt: new Date(),
      error: null,
    },
  });
  if (!result.count) throw new HttpError(404, 'Pending email update not found.');
};
