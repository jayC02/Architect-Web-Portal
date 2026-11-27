import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';
import { resolveEntitlement, SUBSCRIPTION_REQUIRED_CODE, type SubscriptionSnapshot } from '@/server/billing/entitlement';

type Db = PrismaClient | Prisma.TransactionClient;

export const subscriptionRequiredError = (reason: string) =>
  new HttpError(402, reason, { code: SUBSCRIPTION_REQUIRED_CODE });

export const assertEntitled = (subscription: SubscriptionSnapshot | null | undefined) => {
  const entitlement = resolveEntitlement(subscription);
  if (!entitlement.allowed) throw subscriptionRequiredError(entitlement.reason);
  return entitlement;
};

// Used by bearer-token (Agent / desktop) routes that don't go through the
// session middleware.
export const assertOrganisationEntitled = async (organisationId: string, db: Db = prisma) => {
  const subscription = await db.organisationSubscription.findUnique({ where: { organisationId } });
  return { subscription, entitlement: assertEntitled(subscription) };
};

// Workspaces whose subscription allows access right now. Scheduled jobs that
// work on a practice's behalf (Gmail, Xero, workflow effects) only process these,
// so a lapsed or suspended workspace stops costing API calls and sending updates.
// Its data is untouched and picks up again when the subscription is restored.
const ACCESS_STATUSES = ['ACTIVE', 'TRIALING', 'PAST_DUE', 'COMPLIMENTARY'] as const;

export const entitledOrganisationIds = async (db: Db = prisma, now: Date = new Date()) => {
  const subscriptions = await db.organisationSubscription.findMany({
    where: { status: { in: [...ACCESS_STATUSES] } },
    select: {
      organisationId: true, status: true, plan: true, trialEndsAt: true,
      currentPeriodEndsAt: true, graceEndsAt: true, cancelAtPeriodEnd: true,
    },
  });
  return subscriptions
    .filter((subscription) => resolveEntitlement(subscription, now).allowed)
    .map((subscription) => subscription.organisationId);
};

export const platformAdminEmails = () =>
  (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

export const isPlatformAdmin = (email: string | null | undefined) =>
  Boolean(email) && platformAdminEmails().includes(String(email).toLowerCase());
