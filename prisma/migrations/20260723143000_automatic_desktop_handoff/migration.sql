ALTER TABLE "AutomationJob"
ADD COLUMN "handoffCodeHash" TEXT,
ADD COLUMN "handoffExpiresAt" TIMESTAMP(3),
ADD COLUMN "handoffRedeemedAt" TIMESTAMP(3);

ALTER TABLE "DesktopAccessToken"
ADD COLUMN "automationJobId" TEXT;

CREATE UNIQUE INDEX "AutomationJob_handoffCodeHash_key" ON "AutomationJob"("handoffCodeHash");
CREATE INDEX "AutomationJob_handoffExpiresAt_idx" ON "AutomationJob"("handoffExpiresAt");
CREATE INDEX "DesktopAccessToken_automationJobId_revokedAt_idx" ON "DesktopAccessToken"("automationJobId", "revokedAt");

ALTER TABLE "DesktopAccessToken" ADD CONSTRAINT "DesktopAccessToken_automationJobId_fkey"
FOREIGN KEY ("automationJobId") REFERENCES "AutomationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
