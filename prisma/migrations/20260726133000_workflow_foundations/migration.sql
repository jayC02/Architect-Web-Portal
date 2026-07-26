ALTER TYPE "AutomationJobStatus" ADD VALUE IF NOT EXISTS 'PREFLIGHT_REQUIRED';
ALTER TYPE "AutomationJobStatus" ADD VALUE IF NOT EXISTS 'NEEDS_INPUT';
ALTER TYPE "AutomationJobStatus" ADD VALUE IF NOT EXISTS 'STALE';
ALTER TYPE "AutomationJobStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PORTAL_REVIEW';
ALTER TYPE "AutomationJobStatus" ADD VALUE IF NOT EXISTS 'FAILED_RETRYABLE';
ALTER TYPE "AutomationJobStatus" ADD VALUE IF NOT EXISTS 'FAILED_FINAL';

ALTER TABLE "Client"
ADD COLUMN "title" TEXT,
ADD COLUMN "firstName" TEXT,
ADD COLUMN "lastName" TEXT,
ADD COLUMN "companyName" TEXT,
ADD COLUMN "addressLine1" TEXT,
ADD COLUMN "addressLine2" TEXT,
ADD COLUMN "townCity" TEXT,
ADD COLUMN "postcode" TEXT,
ADD COLUMN "country" TEXT;

CREATE TABLE "OrganisationCertifierPreset" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "schemeType" TEXT,
    "registrationAPart1" TEXT,
    "registrationAPart2" TEXT,
    "registrationBPart1" TEXT,
    "registrationBPart2" TEXT,
    "certifierName" TEXT,
    "approvedBody" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganisationCertifierPreset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganisationDefaults" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "practiceName" TEXT,
    "agentFirstName" TEXT,
    "agentLastName" TEXT,
    "agentEmail" TEXT,
    "agentPhone" TEXT,
    "agentAddressLine1" TEXT,
    "agentAddressLine2" TEXT,
    "agentTownCity" TEXT,
    "agentPostcode" TEXT,
    "agentCountry" TEXT NOT NULL DEFAULT 'United Kingdom',
    "defaultCertifierPresetId" TEXT,
    "applicationDefaults" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganisationDefaults_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PlanningApplication"
ADD COLUMN "description" TEXT,
ADD COLUMN "preparationData" JSONB,
ADD COLUMN "preparedAt" TIMESTAMP(3),
ADD COLUMN "reviewedAt" TIMESTAMP(3);

ALTER TABLE "BuildingWarrantApplication"
ADD COLUMN "presetKey" TEXT,
ADD COLUMN "presetVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "description" TEXT,
ADD COLUMN "estimatedValue" DECIMAL(12,2),
ADD COLUMN "currentUse" TEXT,
ADD COLUMN "proposedUse" TEXT,
ADD COLUMN "preparationData" JSONB,
ADD COLUMN "selectedCertifierPresetId" TEXT,
ADD COLUMN "preparedAt" TIMESTAMP(3),
ADD COLUMN "reviewedAt" TIMESTAMP(3);

ALTER TABLE "AutomationJob"
ADD COLUMN "snapshotHash" TEXT,
ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3),
ADD COLUMN "preparedAt" TIMESTAMP(3),
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "resultData" JSONB,
ADD COLUMN "lastCheckpoint" TEXT;

CREATE UNIQUE INDEX "OrganisationDefaults_organisationId_key" ON "OrganisationDefaults"("organisationId");
CREATE INDEX "OrganisationDefaults_defaultCertifierPresetId_idx" ON "OrganisationDefaults"("defaultCertifierPresetId");
CREATE UNIQUE INDEX "OrganisationCertifierPreset_organisationId_displayName_key" ON "OrganisationCertifierPreset"("organisationId", "displayName");
CREATE INDEX "OrganisationCertifierPreset_organisationId_isDefault_idx" ON "OrganisationCertifierPreset"("organisationId", "isDefault");
CREATE INDEX "BuildingWarrantApplication_selectedCertifierPresetId_idx" ON "BuildingWarrantApplication"("selectedCertifierPresetId");

ALTER TABLE "OrganisationDefaults"
ADD CONSTRAINT "OrganisationDefaults_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganisationCertifierPreset"
ADD CONSTRAINT "OrganisationCertifierPreset_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganisationDefaults"
ADD CONSTRAINT "OrganisationDefaults_defaultCertifierPresetId_fkey"
FOREIGN KEY ("defaultCertifierPresetId") REFERENCES "OrganisationCertifierPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BuildingWarrantApplication"
ADD CONSTRAINT "BuildingWarrantApplication_selectedCertifierPresetId_fkey"
FOREIGN KEY ("selectedCertifierPresetId") REFERENCES "OrganisationCertifierPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AutomationJobEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "automationJobId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationJobEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutomationJobEvent_idempotencyKey_key" ON "AutomationJobEvent"("idempotencyKey");
CREATE INDEX "AutomationJobEvent_organisationId_automationJobId_createdAt_idx"
ON "AutomationJobEvent"("organisationId", "automationJobId", "createdAt");
CREATE INDEX "AutomationJobEvent_automationJobId_eventType_idx"
ON "AutomationJobEvent"("automationJobId", "eventType");

ALTER TABLE "AutomationJobEvent"
ADD CONSTRAINT "AutomationJobEvent_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AutomationJobEvent"
ADD CONSTRAINT "AutomationJobEvent_automationJobId_fkey"
FOREIGN KEY ("automationJobId") REFERENCES "AutomationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
