import type { ApplicationUsageStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { isPlanId, stripeMeterEventName, stripeUsagePriceIdFor } from '@/config/plans';
import { sendMeterEvent, stripeConfigured } from '@/server/billing/stripe';

// Per-application metering. An "application" is counted the first time the
// Agent completes it (re-runs of the same application are free). Each plan
// includes a monthly allowance; only applications beyond it are reported to
// Stripe, which charges the plan's flat per-application usage price.

export const usagePeriodMonth = (date: Date) => date.toISOString().slice(0, 7);

export const classifyUsage = (input: {
  subscriptionStatus: SubscriptionStatus | null;
  plan: string | null;
  hasStripeCustomer: boolean;
  includedApplications: number;
  usedThisMonth: number;
  usagePriceConfigured: boolean;
}): ApplicationUsageStatus => {
  if (input.usedThisMonth < input.includedApplications) return 'INCLUDED';
  const paying = input.subscriptionStatus === 'ACTIVE' || input.subscriptionStatus === 'PAST_DUE';
  // Trials, comped and manually invoiced (Firm) workspaces aren't metered.
  if (!paying || !input.hasStripeCustomer || !isPlanId(input.plan) || !input.usagePriceConfigured) return 'NOT_BILLED';
  return 'PENDING';
};

// Call inside the transaction that marks the job COMPLETED, while the
// organisation's execution lock is held, so the monthly count can't race.
export const recordApplicationUsage = async (
  tx: Prisma.TransactionClient,
  input: { organisationId: string; job: { id: string; type: string }; applicationId: string | null; completedAt: Date },
) => {
  const billableKey = `${input.job.type}:${input.applicationId ?? `job:${input.job.id}`}`;
  const existing = await tx.applicationUsage.findUnique({
    where: { organisationId_billableKey: { organisationId: input.organisationId, billableKey } },
    select: { id: true },
  });
  if (existing) return null;
  const periodMonth = usagePeriodMonth(input.completedAt);
  const [subscription, usedThisMonth] = await Promise.all([
    tx.organisationSubscription.findUnique({ where: { organisationId: input.organisationId } }),
    tx.applicationUsage.count({ where: { organisationId: input.organisationId, periodMonth } }),
  ]);
  const plan = subscription?.plan ?? null;
  const status = classifyUsage({
    subscriptionStatus: subscription?.status ?? null,
    plan,
    hasStripeCustomer: Boolean(subscription?.stripeCustomerId),
    includedApplications: subscription?.includedApplications ?? 0,
    usedThisMonth,
    usagePriceConfigured: isPlanId(plan) && Boolean(stripeUsagePriceIdFor(plan)),
  });
  return tx.applicationUsage.create({
    data: {
      organisationId: input.organisationId, automationJobId: input.job.id, billableKey,
      jobType: input.job.type, periodMonth, plan, status, createdAt: input.completedAt,
    },
  });
};

// Best-effort after the completion commits, and retried by the daily cron.
export const reportPendingUsage = async (organisationId?: string, limit = 200) => {
  if (!stripeConfigured()) return { reported: 0, failed: 0 };
  const pending = await prisma.applicationUsage.findMany({
    where: { status: 'PENDING', ...(organisationId ? { organisationId } : {}) },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { organisation: { select: { subscription: { select: { stripeCustomerId: true } } } } },
  });
  let reported = 0;
  let failed = 0;
  for (const usage of pending) {
    const customerId = usage.organisation.subscription?.stripeCustomerId;
    if (!customerId) continue;
    try {
      // Stripe only accepts meter events up to 35 days old.
      const timestamp = Date.now() - usage.createdAt.getTime() > 30 * 86_400_000 ? new Date() : usage.createdAt;
      await sendMeterEvent({ eventName: stripeMeterEventName(), customerId, identifier: `usage_${usage.id}`, timestamp });
      await prisma.applicationUsage.update({ where: { id: usage.id }, data: { status: 'REPORTED', reportedAt: new Date(), lastError: null } });
      reported += 1;
    } catch (error) {
      failed += 1;
      await prisma.applicationUsage.update({
        where: { id: usage.id },
        data: { lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500) },
      });
    }
  }
  return { reported, failed };
};

export const monthlyUsageSummary = async (organisationId: string, now = new Date()) => {
  const periodMonth = usagePeriodMonth(now);
  const used = await prisma.applicationUsage.count({ where: { organisationId, periodMonth } });
  const billed = await prisma.applicationUsage.count({ where: { organisationId, periodMonth, status: { in: ['PENDING', 'REPORTED'] } } });
  return { periodMonth, used, billed };
};
