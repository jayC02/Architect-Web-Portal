-- AlterTable
ALTER TABLE "ApplicationDraft" ADD COLUMN     "documentSetRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reviewRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ApplicationDraftDocument" ADD COLUMN     "cancelledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UploadRateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "UploadRateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ProjectUploadIntent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "clientSha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "projectDocumentId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectUploadIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectUploadIntent_organisationId_status_idx" ON "ProjectUploadIntent"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectUploadIntent_projectId_identity_key" ON "ProjectUploadIntent"("projectId", "identity");
