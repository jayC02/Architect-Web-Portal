-- Subscription gating, demo access requests and Stripe webhook idempotency.
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING_PAYMENT', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'SUSPENDED', 'COMPLIMENTARY');
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "OrganisationSubscription" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "plan" TEXT,
    "billingInterval" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SELF_SERVE',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "graceEndsAt" TIMESTAMP(3),
    "agentDeviceLimit" INTEGER NOT NULL DEFAULT 1,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganisationSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganisationSubscription_organisationId_key" ON "OrganisationSubscription"("organisationId");
CREATE UNIQUE INDEX "OrganisationSubscription_stripeCustomerId_key" ON "OrganisationSubscription"("stripeCustomerId");
CREATE UNIQUE INDEX "OrganisationSubscription_stripeSubscriptionId_key" ON "OrganisationSubscription"("stripeSubscriptionId");
CREATE INDEX "OrganisationSubscription_status_idx" ON "OrganisationSubscription"("status");
ALTER TABLE "OrganisationSubscription" ADD CONSTRAINT "OrganisationSubscription_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "practiceName" TEXT NOT NULL,
    "role" TEXT,
    "practiceSize" TEXT,
    "phone" TEXT,
    "message" TEXT,
    "interest" TEXT,
    "plan" TEXT,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "reviewedByEmail" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "organisationId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccessRequest_inviteTokenHash_key" ON "AccessRequest"("inviteTokenHash");
CREATE INDEX "AccessRequest_status_createdAt_idx" ON "AccessRequest"("status", "createdAt");
CREATE INDEX "AccessRequest_email_idx" ON "AccessRequest"("email");
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- Existing organisations keep access. Downgrade any you want to bill from /admin/access.
INSERT INTO "OrganisationSubscription" ("id", "organisationId", "status", "source", "agentDeviceLimit", "notes", "updatedAt")
SELECT 'sub_' || "id", "id", 'COMPLIMENTARY', 'LEGACY', 10, 'Backfilled when subscription gating launched.', CURRENT_TIMESTAMP
FROM "Organisation"
ON CONFLICT ("organisationId") DO NOTHING;
