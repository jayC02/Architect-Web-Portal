ALTER TABLE "AgentEnrollmentToken"
  ADD COLUMN "installationId" TEXT,
  ADD COLUMN "codeChallenge" TEXT;

CREATE TABLE "AgentSetupIntent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentSetupIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentSetupIntent_tokenHash_key" ON "AgentSetupIntent"("tokenHash");
CREATE INDEX "AgentSetupIntent_organisationId_createdByUserId_expiresAt_usedAt_idx"
  ON "AgentSetupIntent"("organisationId", "createdByUserId", "expiresAt", "usedAt");

ALTER TABLE "AgentSetupIntent"
  ADD CONSTRAINT "AgentSetupIntent_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentSetupIntent"
  ADD CONSTRAINT "AgentSetupIntent_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
