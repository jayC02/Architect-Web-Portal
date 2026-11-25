import type { SubscriptionStatus } from '@prisma/client';

// Pure entitlement rules. Kept free of database and framework imports so they
// can be unit tested and shared by the middleware, desktop auth and licences.

export type SubscriptionSnapshot = {
  status: SubscriptionStatus;
  plan?: string | null;
  trialEndsAt?: Date | null;
  currentPeriodEndsAt?: Date | null;
  graceEndsAt?: Date | null;
  cancelAtPeriodEnd?: boolean | null;
  agentDeviceLimit?: number | null;
};

export type Entitlement = {
  allowed: boolean;
  status: SubscriptionStatus | 'NONE';
  // When access ends if nothing changes; null means open-ended.
  accessEndsAt: Date | null;
  reason: string;
  warning: string | null;
};

// Stripe webhooks can arrive late; don't cut off a paying customer the second a
// period rolls over before the renewal event lands.
export const PERIOD_END_TOLERANCE_MS = 3 * 24 * 60 * 60 * 1000;
export const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const daysLeft = (end: Date, now: Date) => Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));

const deny = (status: Entitlement['status'], reason: string): Entitlement =>
  ({ allowed: false, status, accessEndsAt: null, reason, warning: null });

export const resolveEntitlement = (
  subscription: SubscriptionSnapshot | null | undefined,
  now: Date = new Date(),
): Entitlement => {
  if (!subscription) return deny('NONE', 'This workspace does not have a subscription yet.');
  const { status } = subscription;

  switch (status) {
    case 'COMPLIMENTARY':
      return { allowed: true, status, accessEndsAt: null, reason: 'Complimentary access.', warning: null };

    case 'TRIALING': {
      const end = subscription.trialEndsAt ?? subscription.currentPeriodEndsAt;
      if (!end || end <= now) return deny(status, 'Your trial has ended. Choose a plan to keep using Architect Pro.');
      const left = daysLeft(end, now);
      return {
        allowed: true, status, accessEndsAt: end, reason: 'Trial.',
        warning: left <= 5 ? `Your trial ends in ${left} day${left === 1 ? '' : 's'}. Choose a plan to keep access.` : null,
      };
    }

    case 'ACTIVE': {
      const end = subscription.currentPeriodEndsAt;
      if (end && end.getTime() + PERIOD_END_TOLERANCE_MS <= now.getTime()) {
        return deny(status, 'Your subscription period has ended. Update your billing details to continue.');
      }
      return {
        allowed: true, status, accessEndsAt: end ? new Date(end.getTime() + PERIOD_END_TOLERANCE_MS) : null,
        reason: 'Active subscription.',
        warning: subscription.cancelAtPeriodEnd && end
          ? `Your subscription is set to cancel on ${end.toLocaleDateString('en-GB')}.` : null,
      };
    }

    case 'PAST_DUE': {
      const end = subscription.graceEndsAt;
      if (!end || end <= now) return deny(status, 'Your last payment failed. Update your card to restore access.');
      return {
        allowed: true, status, accessEndsAt: end, reason: 'Payment grace period.',
        warning: `Your last payment failed. Update your card within ${daysLeft(end, now)} days to avoid losing access.`,
      };
    }

    case 'PENDING_PAYMENT':
      return deny(status, 'Choose a plan to activate your workspace.');
    case 'CANCELED':
      return deny(status, 'Your subscription has been cancelled. Choose a plan to reactivate your workspace.');
    case 'SUSPENDED':
      return deny(status, 'This workspace has been suspended. Contact Architect Pro support.');
    default:
      return deny(status, 'This workspace does not have an active subscription.');
  }
};

export const SUBSCRIPTION_REQUIRED_CODE = 'SUBSCRIPTION_REQUIRED';
