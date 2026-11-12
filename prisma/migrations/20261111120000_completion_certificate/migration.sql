ALTER TYPE "AutomationJobType" ADD VALUE 'COMPLETION_CERTIFICATE';

ALTER TABLE "BuildingWarrantApplication"
  ADD COLUMN "completionPreparationData" JSONB,
  ADD COLUMN "completionPreparedAt" TIMESTAMP(3);
