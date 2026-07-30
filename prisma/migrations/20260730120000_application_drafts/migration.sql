CREATE TYPE "ApplicationDraftStatus" AS ENUM (
  'UPLOADING',
  'ANALYSING',
  'NEEDS_REVIEW',
  'READY_TO_CREATE',
  'COMMITTING',
  'COMMITTED',
  'FAILED',
  'CANCELLED',
  'EXPIRED'
);

CREATE TYPE "ApplicationDraftType" AS ENUM (
  'AUTO',
  'HOUSEHOLDER_PLANNING',
  'PLANNING_APPLICATION',
  'BUILDING_WARRANT'
);

CREATE TYPE "ApplicationDraftDocumentStatus" AS ENUM (
  'PENDING',
  'ANALYSING',
  'SUCCESS',
  'FALLBACK',
  'FAILED'
);

CREATE TABLE "ApplicationDraft" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "status" "ApplicationDraftStatus" NOT NULL DEFAULT 'UPLOADING',
  "notes" TEXT,
  "suggestedApplicationType" "ApplicationDraftType",
  "selectedApplicationType" "ApplicationDraftType",
  "preparedData" JSONB,
  "confirmedData" JSONB,
  "unresolvedQuestions" JSONB,
  "analysisSummary" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "committedAt" TIMESTAMP(3),
  "resultingProjectId" TEXT,
  "resultingPlanningId" TEXT,
  "resultingWarrantId" TEXT,
  "resultingAutomationJobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ApplicationDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationDraftDocument" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "analysisStatus" "ApplicationDraftDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "analysisVersion" TEXT,
  "analysisProvider" TEXT,
  "analysisModel" TEXT,
  "analysisPromptVersion" TEXT,
  "analysisSchemaVersion" TEXT,
  "analysisResult" JSONB,
  "analysisError" TEXT,
  "documentType" "DocumentType" NOT NULL DEFAULT 'OTHER',
  "documentStatus" "DocumentStatus" NOT NULL DEFAULT 'IN_REVIEW',
  "revision" TEXT,
  "drawingNumber" TEXT,
  "drawingTitle" TEXT,
  "classificationSource" "DocumentSortSource",
  "confidence" DOUBLE PRECISION,
  "classificationReason" TEXT,
  "committedDocumentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ApplicationDraftDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApplicationDraft_organisationId_status_updatedAt_idx"
  ON "ApplicationDraft"("organisationId", "status", "updatedAt");

CREATE INDEX "ApplicationDraft_organisationId_createdById_createdAt_idx"
  ON "ApplicationDraft"("organisationId", "createdById", "createdAt");

CREATE INDEX "ApplicationDraft_expiresAt_status_idx"
  ON "ApplicationDraft"("expiresAt", "status");

CREATE INDEX "ApplicationDraft_resultingProjectId_idx"
  ON "ApplicationDraft"("resultingProjectId");

CREATE INDEX "ApplicationDraftDocument_draftId_createdAt_idx"
  ON "ApplicationDraftDocument"("draftId", "createdAt");

CREATE INDEX "ApplicationDraftDocument_draftId_analysisStatus_idx"
  ON "ApplicationDraftDocument"("draftId", "analysisStatus");

CREATE INDEX "ApplicationDraftDocument_sha256_analysisVersion_analysisProvider_analysisModel_idx"
  ON "ApplicationDraftDocument"("sha256", "analysisVersion", "analysisProvider", "analysisModel");

CREATE INDEX "ApplicationDraftDocument_committedDocumentId_idx"
  ON "ApplicationDraftDocument"("committedDocumentId");

ALTER TABLE "ApplicationDraft"
  ADD CONSTRAINT "ApplicationDraft_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApplicationDraft"
  ADD CONSTRAINT "ApplicationDraft_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApplicationDraftDocument"
  ADD CONSTRAINT "ApplicationDraftDocument_draftId_fkey"
  FOREIGN KEY ("draftId") REFERENCES "ApplicationDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
