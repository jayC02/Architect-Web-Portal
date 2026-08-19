CREATE TYPE "GmailPlanningClassification" AS ENUM (
  'APPLICATION_RECEIVED',
  'APPLICATION_VALIDATED',
  'INFORMATION_REQUESTED',
  'DECISION_APPROVED',
  'DECISION_REFUSED',
  'DECISION_OTHER',
  'LIKELY_PROJECT_EMAIL',
  'UNKNOWN'
);

ALTER TYPE "LifecycleEventType" ADD VALUE 'PLANNING_VALIDATED';
ALTER TYPE "LifecycleEventType" ADD VALUE 'PLANNING_INFORMATION_REQUESTED';
ALTER TYPE "LifecycleEventSource" ADD VALUE 'GMAIL';
ALTER TYPE "ActionItemKind" ADD VALUE 'PLANNING_CORRESPONDENCE';
ALTER TYPE "ActionItemKind" ADD VALUE 'GMAIL_MONITORING';
ALTER TYPE "ProjectActivityEventType" ADD VALUE 'PLANNING_VALIDATED';
ALTER TYPE "ProjectActivityEventType" ADD VALUE 'PLANNING_INFORMATION_REQUESTED';
ALTER TYPE "ProjectActivityEventType" ADD VALUE 'DECISION_NOTICE_IMPORTED';
ALTER TYPE "ProjectActivityEventType" ADD VALUE 'BUILDING_WARRANT_ACTIVATED';

ALTER TABLE "TrackedEmail"
  ADD COLUMN "planningClassification" "GmailPlanningClassification",
  ADD COLUMN "classificationConfidence" DOUBLE PRECISION,
  ADD COLUMN "classificationReason" TEXT,
  ADD COLUMN "automaticTransitionAt" TIMESTAMP(3);

CREATE INDEX "TrackedEmail_organisationId_planningClassification_sentAt_idx"
  ON "TrackedEmail"("organisationId", "planningClassification", "sentAt");

ALTER TABLE "ActionItem" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "ActionItem" ALTER COLUMN "sourceLifecycleEventId" DROP NOT NULL;
