CREATE TYPE "ApplicationDraftDocumentUploadStatus" AS ENUM ('UPLOADING', 'UPLOADED', 'READY', 'FAILED');

ALTER TABLE "ApplicationDraftDocument"
  ALTER COLUMN "sha256" DROP NOT NULL,
  ADD COLUMN "clientSha256" TEXT,
  ADD COLUMN "uploadIntentKey" TEXT,
  ADD COLUMN "uploadStatus" "ApplicationDraftDocumentUploadStatus" NOT NULL DEFAULT 'UPLOADING',
  ADD COLUMN "finalisedAt" TIMESTAMP(3);

UPDATE "ApplicationDraftDocument"
SET "uploadIntentKey" = 'legacy:' || "id",
    "uploadStatus" = 'READY',
    "finalisedAt" = "createdAt";

ALTER TABLE "ApplicationDraftDocument"
  ALTER COLUMN "uploadIntentKey" SET NOT NULL;

CREATE INDEX "ApplicationDraftDocument_draftId_uploadStatus_createdAt_idx"
  ON "ApplicationDraftDocument"("draftId", "uploadStatus", "createdAt");

CREATE UNIQUE INDEX "ApplicationDraftDocument_draftId_uploadIntentKey_key"
  ON "ApplicationDraftDocument"("draftId", "uploadIntentKey");
