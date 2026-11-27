import { AutomationJobStatus, type ApplicationUsageStatus, type Prisma, type PrismaClient, type SubscriptionStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';
import { automationJobApplicationId } from '@/server/services/desktop-automation-status.service';
import { isPlanId, stripeMeterEventName, stripeUsagePriceIdFor } from '@/config/plans';
import { sendMeterEvent, stripeConfigured } from '@/server/billing/stripe';

// Per-application metering. An "application" is counted the first time the
// Agent completes it (re-runs of the same application are free). Each plan
// includes a monthly allowance; only applications beyond it are reported to
// Stripe, which charges the plan's flat per-application usage price.

export const usagePeriodMonth = (date: Date) => date.toISOString().slice(0, 7);

/** One application, however many times its job is re-run. */
export const billableKeyFor = (job: { id: string; type: string }, applicationId: string | null) =>
  `${job.type}:${applicationId ?? `job:${job.id}`}`;

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
  const billableKey = billableKeyFor(input.job, input.applicationId);
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

// ---------- 14-day evaluation allowance ----------
// An evaluation workspace can send a limited number of applications through the
// Agent. Set TRIAL_APPLICATION_LIMIT to change it; the default is 5.
export const DEFAULT_EVALUATION_APPLICATION_LIMIT = 5;
export const EVALUATION_LIMIT_CODE = 'EVALUATION_LIMIT_REACHED';

export const evaluationApplicationLimit = () => {
  const configured = Number(process.env.TRIAL_APPLICATION_LIMIT);
  return Number.isInteger(configured) && configured >= 0 ? configured : DEFAULT_EVALUATION_APPLICATION_LIMIT;
};

// Jobs approved to run that haven't finished: they count against the allowance
// too, so several applications can't be approved past it at once.
const IN_FLIGHT_STATUSES = [
  AutomationJobStatus.READY,
  AutomationJobStatus.CLAIMED,
  AutomationJobStatus.IN_PROGRESS,
  AutomationJobStatus.NEEDS_REVIEW,
  AutomationJobStatus.AWAITING_PORTAL_REVIEW,
];

type AllowanceJob = { id: string; type: string; projectId: string; dataSnapshot: unknown };

/**
 * Call before approving a job to run. Throws 402 when an evaluation workspace has
 * used its allowance. Re-running an application that already counted is always
 * allowed, and paid, complimentary and other workspaces are not limited here.
 */
export const assertEvaluationAllowance = async (
  db: PrismaClient | Prisma.TransactionClient,
  input: { organisationId: string; job: AllowanceJob },
) => {
  const subscription = await db.organisationSubscription.findUnique({
    where: { organisationId: input.organisationId },
    select: { status: true },
  });
  if (subscription?.status !== 'TRIALING') return { limited: false as const };

  const limit = evaluationApplicationLimit();
  const keyOf = (job: AllowanceJob) =>
    billableKeyFor(job, automationJobApplicationId(job as Parameters<typeof automationJobApplicationId>[0]));
  const key = keyOf(input.job);

  const [counted, inFlight] = await Promise.all([
    db.applicationUsage.findMany({ where: { organisationId: input.organisationId }, select: { billableKey: true } }),
    db.automationJob.findMany({
      where: {
        organisationId: input.organisationId,
        id: { not: input.job.id },
        executionAuthorisedAt: { not: null },
        status: { in: IN_FLIGHT_STATUSES },
      },
      select: { id: true, type: true, projectId: true, dataSnapshot: true },
    }),
  ]);
  const used = new Set(counted.map((usage) => usage.billableKey));
  if (used.has(key)) return { limited: true as const, limit, used: used.size };
  for (const job of inFlight) used.add(keyOf(job));
  used.delete(key);
  if (used.size >= limit) {
    throw new HttpError(
      402,
      `Your 14-day evaluation includes ${limit} application${limit === 1 ? '' : 's'} sent through the Agent, and you have used them. Choose a plan to send more.`,
      { code: EVALUATION_LIMIT_CODE },
    );
  }
  return { limited: true as const, limit, used: used.size };
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
