-- CreateEnum
CREATE TYPE "AutomationJobType" AS ENUM ('HOUSEHOLDER_PLANNING', 'PLANNING_APPLICATION', 'BUILDING_WARRANT');

-- CreateEnum
CREATE TYPE "AutomationJobStatus" AS ENUM ('DRAFT', 'READY', 'CLAIMED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AutomationJobSourceType" AS ENUM ('PROJECT', 'PLANNING_RECORD', 'WARRANT_RECORD', 'DOCUMENT_BATCH', 'MANUAL');

-- CreateTable
CREATE TABLE "AutomationJob" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "AutomationJobType" NOT NULL,
    "status" "AutomationJobStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceType" "AutomationJobSourceType" NOT NULL DEFAULT 'PROJECT',
    "title" TEXT NOT NULL,
    "dataSnapshot" JSONB NOT NULL,
    "documentSnapshot" JSONB NOT NULL,
    "resultSummary" TEXT,
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "claimedByUserId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationJob_organisationId_projectId_status_type_createdAt_idx" ON "AutomationJob"("organisationId", "projectId", "status", "type", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationJob_organisationId_status_createdAt_idx" ON "AutomationJob"("organisationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationJob_createdById_idx" ON "AutomationJob"("createdById");

-- CreateIndex
CREATE INDEX "AutomationJob_claimedByUserId_idx" ON "AutomationJob"("claimedByUserId");

-- AddForeignKey
ALTER TABLE "AutomationJob" ADD CONSTRAINT "AutomationJob_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationJob" ADD CONSTRAINT "AutomationJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationJob" ADD CONSTRAINT "AutomationJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationJob" ADD CONSTRAINT "AutomationJob_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
