-- CreateTable
CREATE TABLE "DocumentProcessingJob" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "draftId" TEXT,
    "draftDocumentId" TEXT,
    "projectDocumentId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'DOCUMENT',
    "idempotencyKey" TEXT NOT NULL,
    "processingVersion" TEXT NOT NULL,
    "documentSetRevision" INTEGER,
    "reviewRevision" INTEGER,
    "state" TEXT NOT NULL DEFAULT 'WAITING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseGeneration" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentProcessingJob_idempotencyKey_key" ON "DocumentProcessingJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DocumentProcessingJob_state_nextAttemptAt_leaseExpiresAt_idx" ON "DocumentProcessingJob"("state", "nextAttemptAt", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "DocumentProcessingJob_organisationId_state_leaseExpiresAt_idx" ON "DocumentProcessingJob"("organisationId", "state", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "DocumentProcessingJob_draftId_documentSetRevision_idx" ON "DocumentProcessingJob"("draftId", "documentSetRevision");
