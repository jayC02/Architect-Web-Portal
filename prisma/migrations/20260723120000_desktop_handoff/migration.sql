ALTER TYPE "AutomationJobStatus" ADD VALUE IF NOT EXISTS 'NEEDS_REVIEW';

ALTER TABLE "AutomationJob"
ADD COLUMN "payloadVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "claimedDeviceId" TEXT;

CREATE TABLE "DesktopAccessToken" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DesktopAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DesktopAccessToken_tokenHash_key" ON "DesktopAccessToken"("tokenHash");
CREATE INDEX "DesktopAccessToken_organisationId_userId_revokedAt_idx" ON "DesktopAccessToken"("organisationId", "userId", "revokedAt");
CREATE INDEX "DesktopAccessToken_expiresAt_idx" ON "DesktopAccessToken"("expiresAt");

ALTER TABLE "DesktopAccessToken" ADD CONSTRAINT "DesktopAccessToken_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DesktopAccessToken" ADD CONSTRAINT "DesktopAccessToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
