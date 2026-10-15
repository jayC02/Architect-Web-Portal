BEGIN;
CREATE TABLE "UValueCalculation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT,
    "createdById" TEXT,
    "title" TEXT NOT NULL,
    "methodVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "resultSnapshot" JSONB NOT NULL,
    "contextSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UValueCalculation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UValueCalculation_idempotencyKey_key" ON "UValueCalculation"("idempotencyKey");
CREATE INDEX "UValueCalculation_organisationId_createdAt_idx" ON "UValueCalculation"("organisationId", "createdAt");
CREATE INDEX "UValueCalculation_organisationId_projectId_createdAt_idx" ON "UValueCalculation"("organisationId", "projectId", "createdAt");
ALTER TABLE "UValueCalculation" ADD CONSTRAINT "UValueCalculation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UValueCalculation" ADD CONSTRAINT "UValueCalculation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UValueCalculation" ADD CONSTRAINT "UValueCalculation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Custom session authorization is performed by the server. No browser Data API
-- role receives a policy allowing access to these private calculation snapshots.
ALTER TABLE "UValueCalculation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "UValueCalculation" FROM anon, authenticated;
COMMIT;
