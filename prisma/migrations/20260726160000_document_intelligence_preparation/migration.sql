ALTER TABLE "ProjectDocument"
  ADD COLUMN "fileHash" TEXT,
  ADD COLUMN "analysisVersion" TEXT,
  ADD COLUMN "analysisProvider" TEXT,
  ADD COLUMN "analysisModel" TEXT,
  ADD COLUMN "analysisPromptVersion" TEXT,
  ADD COLUMN "analysisSchemaVersion" TEXT,
  ADD COLUMN "analysisStatus" TEXT,
  ADD COLUMN "analysisResult" JSONB,
  ADD COLUMN "analysedAt" TIMESTAMP(3);

CREATE INDEX "ProjectDocument_organisationId_projectId_fileHash_idx"
  ON "ProjectDocument"("organisationId", "projectId", "fileHash");

ALTER TABLE "AutomationJob"
  ADD COLUMN "preparationDraft" JSONB,
  ADD COLUMN "preparationDraftHash" TEXT,
  ADD COLUMN "preparationDraftAt" TIMESTAMP(3);
