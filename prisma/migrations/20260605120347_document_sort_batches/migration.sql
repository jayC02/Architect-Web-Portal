-- CreateEnum
CREATE TYPE "DocumentSortBatchStatus" AS ENUM ('UPLOADED', 'ANALYSING', 'NEEDS_REVIEW', 'ACCEPTED', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentSortSource" AS ENUM ('RULES', 'PDF_TEXT', 'MANUAL');

-- AlterTable
ALTER TABLE "ProjectDocument" ADD COLUMN     "drawingNumber" TEXT,
ADD COLUMN     "drawingTitle" TEXT,
ADD COLUMN     "sortConfidence" DOUBLE PRECISION,
ADD COLUMN     "sortReason" TEXT,
ADD COLUMN     "sortSource" "DocumentSortSource";

-- CreateTable
CREATE TABLE "DocumentSortBatch" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "DocumentSortBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSortBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSortBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "documentId" TEXT,
    "originalFilename" TEXT NOT NULL,
    "suggestedDocumentType" "DocumentType" NOT NULL,
    "finalDocumentType" "DocumentType",
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "matchedRules" JSONB NOT NULL,
    "revision" TEXT,
    "drawingNumber" TEXT,
    "drawingTitle" TEXT,
    "source" "DocumentSortSource" NOT NULL,
    "isLikelyCurrent" BOOLEAN NOT NULL DEFAULT true,
    "suitableForPlanning" BOOLEAN NOT NULL DEFAULT false,
    "suitableForBuildingWarrant" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSortBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentSortBatch_organisationId_projectId_createdAt_idx" ON "DocumentSortBatch"("organisationId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentSortBatch_organisationId_status_idx" ON "DocumentSortBatch"("organisationId", "status");

-- CreateIndex
CREATE INDEX "DocumentSortBatch_createdById_idx" ON "DocumentSortBatch"("createdById");

-- CreateIndex
CREATE INDEX "DocumentSortBatchItem_batchId_idx" ON "DocumentSortBatchItem"("batchId");

-- CreateIndex
CREATE INDEX "DocumentSortBatchItem_documentId_idx" ON "DocumentSortBatchItem"("documentId");

-- AddForeignKey
ALTER TABLE "DocumentSortBatch" ADD CONSTRAINT "DocumentSortBatch_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSortBatch" ADD CONSTRAINT "DocumentSortBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSortBatch" ADD CONSTRAINT "DocumentSortBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSortBatchItem" ADD CONSTRAINT "DocumentSortBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DocumentSortBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSortBatchItem" ADD CONSTRAINT "DocumentSortBatchItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
