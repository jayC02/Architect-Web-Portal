-- CreateEnum
CREATE TYPE "AgentOperatingState" AS ENUM ('DISCONNECTED', 'CONNECTING', 'READY', 'RUNNING', 'USER_ACTION_REQUIRED', 'ERROR');

-- CreateEnum
CREATE TYPE "ProjectFeeMilestoneState" AS ENUM ('PENDING', 'ELIGIBLE', 'DRAFT_CREATING', 'DRAFT_CREATED', 'WAIVED', 'FAILED');

-- CreateEnum
CREATE TYPE "XeroWriteAttemptStatus" AS ENUM ('PENDING', 'PROCESSING', 'UNCERTAIN', 'RETRYABLE', 'SUCCEEDED', 'FAILED_FINAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActionItemKind" ADD VALUE 'DESKTOP_AUTOMATION';
ALTER TYPE "ActionItemKind" ADD VALUE 'XERO_INVOICE';

-- AlterEnum
ALTER TYPE "LifecycleEventType" ADD VALUE 'BUILDING_WARRANT_SUBMITTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProjectActivityEventType" ADD VALUE 'XERO_DRAFT_CREATED';
ALTER TYPE "ProjectActivityEventType" ADD VALUE 'INVOICE_PAID';

-- AlterEnum
ALTER TYPE "ProjectActivityVisibility" ADD VALUE 'FINANCE';

-- AlterTable
ALTER TABLE "AutomationJob" ADD COLUMN     "agentHeartbeatAt" TIMESTAMP(3),
ADD COLUMN     "agentRunId" TEXT,
ADD COLUMN     "claimedByAgentId" TEXT,
ADD COLUMN     "etaSeconds" INTEGER,
ADD COLUMN     "executionAuthorisedAt" TIMESTAMP(3),
ADD COLUMN     "lastProgressSequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "progressMessage" TEXT,
ADD COLUMN     "progressPercent" INTEGER,
ADD COLUMN     "progressStage" TEXT,
ADD COLUMN     "progressStageState" TEXT,
ADD COLUMN     "progressUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AgentRegistration" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "enrolledByUserId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "machineName" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "credentialPrefix" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "operatingState" "AgentOperatingState" NOT NULL DEFAULT 'DISCONNECTED',
    "currentJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEnrollmentToken" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEnrollmentToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationFinanceSettings" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "automaticDraftInvoices" BOOLEAN NOT NULL DEFAULT false,
    "defaultSalesAccountCode" TEXT,
    "defaultTaxType" TEXT,
    "defaultInvoiceDueDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganisationFinanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePlanTemplate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeePlanTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePlanTemplateMilestone" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "milestoneKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "triggerEventType" "LifecycleEventType",
    "amount" DECIMAL(18,2) NOT NULL,
    "invoiceDescription" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "accountCode" TEXT,
    "taxType" TEXT,
    "dueDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeePlanTemplateMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFeePlan" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateVersion" INTEGER,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFeePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFeeMilestone" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectFeePlanId" TEXT NOT NULL,
    "milestoneKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "triggerEventType" "LifecycleEventType",
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "invoiceDescription" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "accountCode" TEXT,
    "taxType" TEXT,
    "dueDays" INTEGER,
    "state" "ProjectFeeMilestoneState" NOT NULL DEFAULT 'PENDING',
    "linkedXeroInvoiceId" TEXT,
    "sourceLifecycleEventId" TEXT,
    "eligibleAt" TIMESTAMP(3),
    "draftCreatedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFeeMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XeroWriteAttempt" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "XeroWriteAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "providerId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "retryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XeroWriteAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentRegistration_installationId_key" ON "AgentRegistration"("installationId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRegistration_credentialHash_key" ON "AgentRegistration"("credentialHash");

-- CreateIndex
CREATE INDEX "AgentRegistration_organisationId_enabled_revokedAt_lastSeen_idx" ON "AgentRegistration"("organisationId", "enabled", "revokedAt", "lastSeenAt");

-- CreateIndex
CREATE INDEX "AgentRegistration_enrolledByUserId_idx" ON "AgentRegistration"("enrolledByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEnrollmentToken_tokenHash_key" ON "AgentEnrollmentToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AgentEnrollmentToken_organisationId_expiresAt_usedAt_idx" ON "AgentEnrollmentToken"("organisationId", "expiresAt", "usedAt");

-- CreateIndex
CREATE INDEX "AgentEnrollmentToken_createdByUserId_idx" ON "AgentEnrollmentToken"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationFinanceSettings_organisationId_key" ON "OrganisationFinanceSettings"("organisationId");

-- CreateIndex
CREATE INDEX "FeePlanTemplate_organisationId_active_name_idx" ON "FeePlanTemplate"("organisationId", "active", "name");

-- CreateIndex
CREATE INDEX "FeePlanTemplate_createdByUserId_idx" ON "FeePlanTemplate"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "FeePlanTemplate_organisationId_name_version_key" ON "FeePlanTemplate"("organisationId", "name", "version");

-- CreateIndex
CREATE INDEX "FeePlanTemplateMilestone_templateId_sortOrder_idx" ON "FeePlanTemplateMilestone"("templateId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "FeePlanTemplateMilestone_templateId_milestoneKey_key" ON "FeePlanTemplateMilestone"("templateId", "milestoneKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFeePlan_projectId_key" ON "ProjectFeePlan"("projectId");

-- CreateIndex
CREATE INDEX "ProjectFeePlan_organisationId_active_idx" ON "ProjectFeePlan"("organisationId", "active");

-- CreateIndex
CREATE INDEX "ProjectFeePlan_templateId_idx" ON "ProjectFeePlan"("templateId");

-- CreateIndex
CREATE INDEX "ProjectFeePlan_createdByUserId_idx" ON "ProjectFeePlan"("createdByUserId");

-- CreateIndex
CREATE INDEX "ProjectFeeMilestone_organisationId_state_eligibleAt_idx" ON "ProjectFeeMilestone"("organisationId", "state", "eligibleAt");

-- CreateIndex
CREATE INDEX "ProjectFeeMilestone_sourceLifecycleEventId_idx" ON "ProjectFeeMilestone"("sourceLifecycleEventId");

-- CreateIndex
CREATE INDEX "ProjectFeeMilestone_linkedXeroInvoiceId_idx" ON "ProjectFeeMilestone"("linkedXeroInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFeeMilestone_projectFeePlanId_milestoneKey_key" ON "ProjectFeeMilestone"("projectFeePlanId", "milestoneKey");

-- CreateIndex
CREATE UNIQUE INDEX "XeroWriteAttempt_milestoneId_key" ON "XeroWriteAttempt"("milestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "XeroWriteAttempt_idempotencyKey_key" ON "XeroWriteAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "XeroWriteAttempt_organisationId_status_retryAt_idx" ON "XeroWriteAttempt"("organisationId", "status", "retryAt");

-- CreateIndex
CREATE INDEX "XeroWriteAttempt_connectionId_status_idx" ON "XeroWriteAttempt"("connectionId", "status");

-- CreateIndex
CREATE INDEX "AutomationJob_organisationId_executionAuthorisedAt_status_c_idx" ON "AutomationJob"("organisationId", "executionAuthorisedAt", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationJob_claimedByAgentId_status_leaseExpiresAt_idx" ON "AutomationJob"("claimedByAgentId", "status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AutomationJob_agentRunId_idx" ON "AutomationJob"("agentRunId");

-- AddForeignKey
ALTER TABLE "AutomationJob" ADD CONSTRAINT "AutomationJob_claimedByAgentId_fkey" FOREIGN KEY ("claimedByAgentId") REFERENCES "AgentRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRegistration" ADD CONSTRAINT "AgentRegistration_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRegistration" ADD CONSTRAINT "AgentRegistration_enrolledByUserId_fkey" FOREIGN KEY ("enrolledByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEnrollmentToken" ADD CONSTRAINT "AgentEnrollmentToken_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEnrollmentToken" ADD CONSTRAINT "AgentEnrollmentToken_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationFinanceSettings" ADD CONSTRAINT "OrganisationFinanceSettings_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePlanTemplate" ADD CONSTRAINT "FeePlanTemplate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePlanTemplate" ADD CONSTRAINT "FeePlanTemplate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePlanTemplateMilestone" ADD CONSTRAINT "FeePlanTemplateMilestone_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FeePlanTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFeePlan" ADD CONSTRAINT "ProjectFeePlan_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFeePlan" ADD CONSTRAINT "ProjectFeePlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFeePlan" ADD CONSTRAINT "ProjectFeePlan_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FeePlanTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFeePlan" ADD CONSTRAINT "ProjectFeePlan_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFeeMilestone" ADD CONSTRAINT "ProjectFeeMilestone_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFeeMilestone" ADD CONSTRAINT "ProjectFeeMilestone_projectFeePlanId_fkey" FOREIGN KEY ("projectFeePlanId") REFERENCES "ProjectFeePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XeroWriteAttempt" ADD CONSTRAINT "XeroWriteAttempt_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XeroWriteAttempt" ADD CONSTRAINT "XeroWriteAttempt_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "XeroConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XeroWriteAttempt" ADD CONSTRAINT "XeroWriteAttempt_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "ProjectFeeMilestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
