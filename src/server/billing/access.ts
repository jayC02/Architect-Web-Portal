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

export const platformAdminEmails = () =>
  (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

export const isPlatformAdmin = (email: string | null | undefined) =>
  Boolean(email) && platformAdminEmails().includes(String(email).toLowerCase());
