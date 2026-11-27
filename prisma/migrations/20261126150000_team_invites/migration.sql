-- Team invitations, so a workspace's plan user limit can be enforced.
-- Additive only: one new table, its indexes and foreign keys.
CREATE TABLE "TeamInvite" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrganisationRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamInvite_tokenHash_key" ON "TeamInvite"("tokenHash");
CREATE INDEX "TeamInvite_organisationId_acceptedAt_revokedAt_idx" ON "TeamInvite"("organisationId", "acceptedAt", "revokedAt");
CREATE INDEX "TeamInvite_email_idx" ON "TeamInvite"("email");

ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Server-side only, like the other access tables: no browser-role access.
ALTER TABLE "TeamInvite" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "TeamInvite" FROM anon, authenticated;
