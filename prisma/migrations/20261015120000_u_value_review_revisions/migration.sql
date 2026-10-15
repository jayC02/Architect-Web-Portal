BEGIN;
ALTER TABLE "UValueCalculation"
  ADD COLUMN "seriesId" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "previousId" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DRAFT',
  ADD CONSTRAINT "UValueCalculation_status_check" CHECK ("status" IN ('DRAFT', 'REVIEWED', 'ISSUED', 'WITHDRAWN')),
  ADD CONSTRAINT "UValueCalculation_revision_check" CHECK ("revision" > 0);
CREATE UNIQUE INDEX "UValueCalculation_organisationId_seriesId_revision_key" ON "UValueCalculation"("organisationId", "seriesId", "revision");
CREATE TABLE "UValueReviewEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "calculationId" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "action" TEXT NOT NULL CHECK ("action" IN ('review', 'issue', 'withdraw')),
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UValueReviewEvent_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "UValueCalculation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UValueReviewEvent_requestKey_key" ON "UValueReviewEvent"("requestKey");
CREATE INDEX "UValueReviewEvent_organisationId_calculationId_createdAt_idx" ON "UValueReviewEvent"("organisationId", "calculationId", "createdAt");
ALTER TABLE "UValueReviewEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "UValueReviewEvent" FROM anon, authenticated;
CREATE TABLE "UValueTemplate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organisationId" TEXT NOT NULL,
  "sourceCalculationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "inputSnapshot" JSONB NOT NULL,
  CONSTRAINT "UValueTemplate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UValueTemplate_organisationId_sourceCalculationId_name_key" ON "UValueTemplate"("organisationId", "sourceCalculationId", "name");
CREATE INDEX "UValueTemplate_organisationId_createdAt_idx" ON "UValueTemplate"("organisationId", "createdAt");
ALTER TABLE "UValueTemplate" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "UValueTemplate" FROM anon, authenticated;
COMMIT;
