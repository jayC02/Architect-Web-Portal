import type { Prisma, SubscriptionStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { PLANS, planForStripePrice } from '@/config/plans';
import { PAST_DUE_GRACE_MS } from '@/server/billing/entitlement';
import {
  retrieveSubscription,
  type StripeCheckoutSession,
  type StripeEvent,
  type StripeInvoice,
  type StripeSubscription,
} from '@/server/billing/stripe';

const STRIPE_STATUS: Record<StripeSubscription['status'], SubscriptionStatus> = {
  active: 'ACTIVE',
  trialing: 'TRIALING',
  past_due: 'PAST_DUE',
  // Unpaid/paused keep the first failure's grace window, which by then has
  // usually run out. SUSPENDED is reserved for manual admin action.
  unpaid: 'PAST_DUE',
  paused: 'PAST_DUE',
  canceled: 'CANCELED',
  incomplete: 'PENDING_PAYMENT',
  incomplete_expired: 'CANCELED',
};

const fromUnix = (value?: number | null) => (value ? new Date(value * 1000) : null);

// Pure mapping from a Stripe subscription to our entitlement row. A comped or
// suspended workspace is never upgraded or downgraded by Stripe on its own.
export const subscriptionDataFromStripe = (
  subscription: StripeSubscription,
  existing: { status: SubscriptionStatus; graceEndsAt: Date | null } | null,
  now = new Date(),
): Prisma.OrganisationSubscriptionUpdateInput => {
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  const mapped = planForStripePrice(priceId);
  // API versions from 2025-03 moved the period end onto the subscription item.
  const periodEnd = fromUnix(item?.current_period_end ?? subscription.current_period_end);
  const status = STRIPE_STATUS[subscription.status] ?? 'PAST_DUE';
  const graceEndsAt = status === 'PAST_DUE'
    ? (existing?.status === 'PAST_DUE' && existing.graceEndsAt ? existing.graceEndsAt : new Date(now.getTime() + PAST_DUE_GRACE_MS))
    : null;

  return {
    status,
    stripeCustomerId: subscription.customer,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    currentPeriodEndsAt: periodEnd,
    trialEndsAt: subscription.status === 'trialing' ? fromUnix(subscription.trial_end) : undefined,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    graceEndsAt,
    ...(mapped ? { plan: mapped.plan, billingInterval: mapped.interval, agentDeviceLimit: PLANS[mapped.plan].agentDeviceLimit } : {}),
  };
};

const PROTECTED_STATUSES: SubscriptionStatus[] = ['COMPLIMENTARY', 'SUSPENDED'];

const applySubscription = async (subscription: StripeSubscription, organisationIdHint?: string | null) => {
  const existing = await prisma.organisationSubscription.findFirst({
    where: {
      OR: [
        { stripeSubscriptionId: subscription.id },
        { stripeCustomerId: subscription.customer },
        ...(organisationIdHint ? [{ organisationId: organisationIdHint }] : []),
        ...(subscription.metadata?.organisationId ? [{ organisationId: subscription.metadata.organisationId }] : []),
      ],
    },
  });
  if (!existing) {
    console.warn('Stripe subscription has no matching organisation', subscription.id);
    return;
  }
  // A manual suspension or comp wins; Stripe only records the ids.
  if (PROTECTED_STATUSES.includes(existing.status)) {
    await prisma.organisationSubscription.update({
      where: { id: existing.id },
      data: { stripeCustomerId: subscription.customer, stripeSubscriptionId: subscription.id },
    });
    return;
  }
  await prisma.organisationSubscription.update({
    where: { id: existing.id },
    data: { ...subscriptionDataFromStripe(subscription, existing), source: existing.source === 'DEMO_INVITE' ? 'DEMO_INVITE' : 'SELF_SERVE' },
  });
};

const invoiceSubscriptionId = (invoice: StripeInvoice) =>
  invoice.subscription ?? invoice.parent?.subscription_details?.subscription ?? null;

export const handleStripeEvent = async (event: StripeEvent) => {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as StripeCheckoutSession;
      if (session.mode !== 'subscription' || !session.subscription) return;
      const organisationId = session.client_reference_id ?? session.metadata?.organisationId ?? null;
      if (organisationId && session.customer) {
        await prisma.organisationSubscription.updateMany({
          where: { organisationId, stripeCustomerId: null },
          data: { stripeCustomerId: session.customer },
        });
      }
      await applySubscription(await retrieveSubscription(session.subscription), organisationId);
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      // Re-fetch so out-of-order deliveries can't apply a stale state.
      await applySubscription(await retrieveSubscription((event.data.object as StripeSubscription).id));
      return;
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const subscriptionId = invoiceSubscriptionId(event.data.object as StripeInvoice);
      if (subscriptionId) await applySubscription(await retrieveSubscription(subscriptionId));
      return;
    }
    default:
  }
};
