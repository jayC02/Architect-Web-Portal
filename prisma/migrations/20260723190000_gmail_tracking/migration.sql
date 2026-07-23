CREATE TYPE "GmailMatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'AMBIGUOUS', 'UNRELATED');
CREATE TYPE "GmailProcessingStatus" AS ENUM ('DISCOVERED', 'PROCESSED', 'NEEDS_REVIEW', 'FAILED');
CREATE TYPE "GmailSuggestionStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'FAILED');
CREATE TYPE "GmailUpdateType" AS ENUM ('PLANNING_APPLICATION', 'BUILDING_WARRANT', 'DEADLINE', 'PROJECT_ACTIVITY');

ALTER TABLE "CalendarConnection"
ADD COLUMN "gmailEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "gmailRequireReview" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "gmailAutoApplyHighConfidence" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "gmailHistoryId" TEXT,
ADD COLUMN "gmailLastSuccessfulSyncAt" TIMESTAMP(3),
ADD COLUMN "gmailLastAttemptedSyncAt" TIMESTAMP(3),
ADD COLUMN "gmailSyncStartedAt" TIMESTAMP(3),
ADD COLUMN "gmailSyncError" TEXT;

ALTER TABLE "Deadline"
ADD COLUMN "sourceKey" TEXT;

CREATE UNIQUE INDEX "Deadline_organisationId_sourceKey_key"
ON "Deadline"("organisationId", "sourceKey");

CREATE TABLE "TrackedEmail" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "gmailThreadId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "recipients" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "textExcerpt" TEXT,
    "matchStatus" "GmailMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "processingStatus" "GmailProcessingStatus" NOT NULL DEFAULT 'DISCOVERED',
    "projectId" TEXT,
    "planningApplicationId" TEXT,
    "buildingWarrantApplicationId" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "matchReason" TEXT,
    "processingError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrackedEmail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GmailUpdateSuggestion" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "trackedEmailId" TEXT NOT NULL,
    "projectId" TEXT,
    "planningApplicationId" TEXT,
    "buildingWarrantApplicationId" TEXT,
    "updateType" "GmailUpdateType" NOT NULL,
    "fieldName" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "existingValue" JSONB,
    "suggestedValue" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "GmailSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "appliedAutomatically" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GmailUpdateSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GmailAttachment" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "trackedEmailId" TEXT NOT NULL,
    "gmailAttachmentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "importedDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GmailAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrackedEmail_organisationId_gmailMessageId_key"
ON "TrackedEmail"("organisationId", "gmailMessageId");
CREATE INDEX "TrackedEmail_organisationId_gmailThreadId_idx"
ON "TrackedEmail"("organisationId", "gmailThreadId");
CREATE INDEX "TrackedEmail_organisationId_matchStatus_sentAt_idx"
ON "TrackedEmail"("organisationId", "matchStatus", "sentAt");
CREATE INDEX "TrackedEmail_organisationId_processingStatus_sentAt_idx"
ON "TrackedEmail"("organisationId", "processingStatus", "sentAt");
CREATE INDEX "TrackedEmail_organisationId_projectId_sentAt_idx"
ON "TrackedEmail"("organisationId", "projectId", "sentAt");
CREATE INDEX "TrackedEmail_planningApplicationId_idx"
ON "TrackedEmail"("planningApplicationId");
CREATE INDEX "TrackedEmail_buildingWarrantApplicationId_idx"
ON "TrackedEmail"("buildingWarrantApplicationId");

CREATE UNIQUE INDEX "GmailUpdateSuggestion_trackedEmailId_dedupeKey_key"
ON "GmailUpdateSuggestion"("trackedEmailId", "dedupeKey");
CREATE INDEX "GmailUpdateSuggestion_organisationId_status_createdAt_idx"
ON "GmailUpdateSuggestion"("organisationId", "status", "createdAt");
CREATE INDEX "GmailUpdateSuggestion_organisationId_projectId_createdAt_idx"
ON "GmailUpdateSuggestion"("organisationId", "projectId", "createdAt");
CREATE INDEX "GmailUpdateSuggestion_planningApplicationId_idx"
ON "GmailUpdateSuggestion"("planningApplicationId");
CREATE INDEX "GmailUpdateSuggestion_buildingWarrantApplicationId_idx"
ON "GmailUpdateSuggestion"("buildingWarrantApplicationId");
CREATE INDEX "GmailUpdateSuggestion_reviewedById_idx"
ON "GmailUpdateSuggestion"("reviewedById");

CREATE UNIQUE INDEX "GmailAttachment_importedDocumentId_key"
ON "GmailAttachment"("importedDocumentId");
CREATE UNIQUE INDEX "GmailAttachment_trackedEmailId_gmailAttachmentId_key"
ON "GmailAttachment"("trackedEmailId", "gmailAttachmentId");
CREATE INDEX "GmailAttachment_organisationId_createdAt_idx"
ON "GmailAttachment"("organisationId", "createdAt");
CREATE INDEX "GmailAttachment_organisationId_sha256_idx"
ON "GmailAttachment"("organisationId", "sha256");

ALTER TABLE "TrackedEmail"
ADD CONSTRAINT "TrackedEmail_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "TrackedEmail_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "TrackedEmail_planningApplicationId_fkey"
FOREIGN KEY ("planningApplicationId") REFERENCES "PlanningApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "TrackedEmail_buildingWarrantApplicationId_fkey"
FOREIGN KEY ("buildingWarrantApplicationId") REFERENCES "BuildingWarrantApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GmailUpdateSuggestion"
ADD CONSTRAINT "GmailUpdateSuggestion_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "GmailUpdateSuggestion_trackedEmailId_fkey"
FOREIGN KEY ("trackedEmailId") REFERENCES "TrackedEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "GmailUpdateSuggestion_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "GmailUpdateSuggestion_planningApplicationId_fkey"
FOREIGN KEY ("planningApplicationId") REFERENCES "PlanningApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "GmailUpdateSuggestion_buildingWarrantApplicationId_fkey"
FOREIGN KEY ("buildingWarrantApplicationId") REFERENCES "BuildingWarrantApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "GmailUpdateSuggestion_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GmailAttachment"
ADD CONSTRAINT "GmailAttachment_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "GmailAttachment_trackedEmailId_fkey"
FOREIGN KEY ("trackedEmailId") REFERENCES "TrackedEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "GmailAttachment_importedDocumentId_fkey"
FOREIGN KEY ("importedDocumentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
