import {
  ActionItemKind,
  ActionItemPriority,
  ActionItemStatus,
  GmailMatchStatus,
  GmailPlanningClassification,
  GmailProcessingStatus,
  GmailSuggestionStatus,
  GmailUpdateType,
  LifecycleEventSource,
  PlanningStatus,
  Prisma,
  type CalendarConnection,
  type PrismaClient,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { ParsedGmailMessage } from '@/lib/integrations/gmail-tracking';
import {
  drainLifecycleEventsBestEffort,
  updatePlanningApplicationInTransaction,
} from '@/server/services/application-lifecycle.service';
import {
  classifyPlanningEmail,
  decideAutomaticPlanningTransition,
  gmailPlanningIdempotencyKey,
  hasExpectedAuthorityEvidence,
  type PlanningClassificationResult,
} from '@/server/services/gmail-planning-classifier.service';

type PlanningCandidate = {
  id: string;
  projectId: string;
  applicationReference: string | null;
  status: PlanningStatus;
  validDate: Date | null;
  decisionDate: Date | null;
  updatedAt: Date;
};

const normaliseReference = (value: string) => value.toLowerCase().replace(/\s+/g, '');

export const messageHasExactPlanningReference = (
  parsed: Pick<ParsedGmailMessage, 'subject' | 'text' | 'excerpt'>,
  reference: string | null,
) => Boolean(reference && normaliseReference(`${parsed.subject} ${parsed.text || parsed.excerpt}`).includes(normaliseReference(reference)));

const transitionData = (
  classification: PlanningClassificationResult,
  targetStatus: PlanningStatus,
): Prisma.PlanningApplicationUncheckedUpdateInput & { status: PlanningStatus } => ({
  status: targetStatus,
  ...(classification.effectiveDate && targetStatus === PlanningStatus.VALIDATED
    ? { validDate: classification.effectiveDate }
    : {}),
  ...(classification.effectiveDate && (targetStatus === PlanningStatus.APPROVED || targetStatus === PlanningStatus.REFUSED)
    ? { decisionDate: classification.effectiveDate }
    : {}),
});

const reviewActionKey = (trackedEmailId: string) => `gmail:planning-correspondence:${trackedEmailId}`;

export const ensurePlanningCorrespondenceReviewAction = (
  database: PrismaClient,
  input: {
    organisationId: string;
    projectId?: string | null;
    trackedEmailId: string;
    projectLabel?: string | null;
    summary: string;
  },
) => database.actionItem.upsert({
  where: {
    organisationId_dedupeKey: {
      organisationId: input.organisationId,
      dedupeKey: reviewActionKey(input.trackedEmailId),
    },
  },
  update: {
    projectId: input.projectId ?? null,
    title: 'Review Planning correspondence',
    summary: input.projectLabel
      ? `We think this email relates to ${input.projectLabel}. ${input.summary}`.slice(0, 500)
      : input.summary.slice(0, 500),
    actionUrl: `/email-updates?email=${encodeURIComponent(input.trackedEmailId)}`,
    priority: ActionItemPriority.HIGH,
    status: ActionItemStatus.OPEN,
    resolvedAt: null,
  },
  create: {
    organisationId: input.organisationId,
    projectId: input.projectId ?? null,
    sourceLifecycleEventId: null,
    kind: ActionItemKind.PLANNING_CORRESPONDENCE,
    title: 'Review Planning correspondence',
    summary: input.projectLabel
      ? `We think this email relates to ${input.projectLabel}. ${input.summary}`.slice(0, 500)
      : input.summary.slice(0, 500),
    actionUrl: `/email-updates?email=${encodeURIComponent(input.trackedEmailId)}`,
    priority: ActionItemPriority.HIGH,
    dedupeKey: reviewActionKey(input.trackedEmailId),
  },
});

export const resolvePlanningCorrespondenceReviewAction = (
  database: PrismaClient,
  organisationId: string,
  trackedEmailId: string,
) => database.actionItem.updateMany({
  where: { organisationId, dedupeKey: reviewActionKey(trackedEmailId), status: ActionItemStatus.OPEN },
  data: { status: ActionItemStatus.RESOLVED, resolvedAt: new Date() },
});

export const processPlanningClassification = async (input: {
  organisationId: string;
  connection: Pick<CalendarConnection, 'gmailAutoApplyHighConfidence' | 'gmailRequireReview'>;
  trackedEmailId: string;
  matchStatus: GmailMatchStatus;
  parsed: ParsedGmailMessage;
  project?: { id: string; name: string; localAuthority?: string | null } | null;
  application?: PlanningCandidate | null;
  aiClassification?: GmailPlanningClassification | null;
  database?: PrismaClient;
}) => {
  const database = input.database ?? prisma;
  const classification = classifyPlanningEmail(input.parsed);
  const application = input.application ?? null;
  const exactApplicationReference = application
    ? messageHasExactPlanningReference(input.parsed, application.applicationReference)
    : false;
  const expectedAuthority = hasExpectedAuthorityEvidence({
    sender: input.parsed.sender,
    localAuthority: input.project?.localAuthority,
    content: `${input.parsed.subject} ${input.parsed.text || input.parsed.excerpt}`,
  });
  const policy = application ? decideAutomaticPlanningTransition({
    classification,
    currentStatus: application.status,
    uniqueProjectMatch: input.matchStatus === GmailMatchStatus.MATCHED,
    exactApplicationReference,
    expectedAuthority,
    newerManualState: application.updatedAt.getTime() > input.parsed.sentAt.getTime(),
    aiClassification: input.aiClassification,
  }) : { automatic: false, reason: 'No exact existing Planning application is linked.', targetStatus: null };

  await database.trackedEmail.update({
    where: { id: input.trackedEmailId },
    data: {
      planningClassification: classification.classification,
      classificationConfidence: classification.confidence,
      classificationReason: `${classification.reason} ${policy.reason}`.slice(0, 1000),
    },
  });

  const canApply = policy.automatic
    && input.connection.gmailAutoApplyHighConfidence
    && !input.connection.gmailRequireReview
    && application
    && policy.targetStatus;
  const dedupeKey = application
    ? gmailPlanningIdempotencyKey(input.parsed.gmailMessageId, application.id, classification.classification)
    : `gmail:${input.parsed.gmailMessageId}:${classification.classification.toLowerCase()}`;

  if (!policy.targetStatus) {
    await database.trackedEmail.update({ where: { id: input.trackedEmailId }, data: { processingStatus: GmailProcessingStatus.NEEDS_REVIEW } });
    await ensurePlanningCorrespondenceReviewAction(database, {
      organisationId: input.organisationId,
      projectId: input.project?.id,
      trackedEmailId: input.trackedEmailId,
      projectLabel: input.project?.name,
      summary: policy.reason,
    });
    return { classification, policy, suggestionId: null, applied: false };
  }

  const suggestion = await database.gmailUpdateSuggestion.upsert({
    where: { trackedEmailId_dedupeKey: { trackedEmailId: input.trackedEmailId, dedupeKey } },
    update: {},
    create: {
      organisationId: input.organisationId,
      trackedEmailId: input.trackedEmailId,
      projectId: input.project?.id ?? null,
      planningApplicationId: application?.id ?? null,
      updateType: GmailUpdateType.PLANNING_APPLICATION,
      fieldName: 'status',
      dedupeKey,
      existingValue: application?.status ?? Prisma.JsonNull,
      suggestedValue: policy.targetStatus ?? classification.classification,
      confidence: classification.confidence,
      reason: `${classification.reason} ${policy.reason}`,
    },
  });

  if (!canApply) {
    await database.trackedEmail.update({ where: { id: input.trackedEmailId }, data: { processingStatus: GmailProcessingStatus.NEEDS_REVIEW } });
    await ensurePlanningCorrespondenceReviewAction(database, {
      organisationId: input.organisationId,
      projectId: input.project?.id,
      trackedEmailId: input.trackedEmailId,
      projectLabel: input.project?.name,
      summary: policy.reason,
    });
    return { classification, policy, suggestionId: suggestion.id, applied: false };
  }

  const result = await database.$transaction(async (tx) => {
    const transition = await updatePlanningApplicationInTransaction(tx, {
      organisationId: input.organisationId,
      planningApplicationId: application.id,
      actorUserId: null,
      source: LifecycleEventSource.GMAIL,
      occurredAt: input.parsed.sentAt,
      data: transitionData(classification, policy.targetStatus!),
      evidence: {
        sourceType: 'GMAIL',
        gmailMessageId: input.parsed.gmailMessageId,
        trackedEmailId: input.trackedEmailId,
        classification: classification.classification,
        exactApplicationReference: true,
        expectedAuthority: true,
      },
    });
    await tx.gmailUpdateSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: GmailSuggestionStatus.APPLIED,
        appliedAutomatically: true,
        appliedAt: new Date(),
        error: null,
      },
    });
    await tx.trackedEmail.update({
      where: { id: input.trackedEmailId },
      data: {
        processingStatus: GmailProcessingStatus.PROCESSED,
        automaticTransitionAt: new Date(),
      },
    });
    await tx.actionItem.updateMany({
      where: { organisationId: input.organisationId, dedupeKey: reviewActionKey(input.trackedEmailId), status: ActionItemStatus.OPEN },
      data: { status: ActionItemStatus.RESOLVED, resolvedAt: new Date() },
    });
    return transition;
  });
  await drainLifecycleEventsBestEffort(input.organisationId, result.lifecycleEventIds);
  return { classification, policy, suggestionId: suggestion.id, applied: true };
};
