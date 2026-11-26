import type { OrganisationSubscription } from '@prisma/client';
import { absoluteUrl } from '@/lib/config';
import { HttpError } from '@/lib/utils/http';
import { intervalFor, PLANS, stripeBasePriceIdFor, stripeUsagePriceIdFor, type BillingInterval, type PlanId } from '@/config/plans';
import { createCheckoutSession, createPortalSession } from '@/server/billing/stripe';

const BILLING_ROLES = ['OWNER', 'ADMIN'];

type BillingAuth = {
  user: { email: string };
  membership: { role: string };
  organisation: { id: string; subscription: OrganisationSubscription | null };
};

export const assertCanManageBilling = (auth: BillingAuth) => {
  if (!BILLING_ROLES.includes(auth.membership.role)) {
    throw new HttpError(403, 'Only an owner or admin of this workspace can manage billing.');
  }
};

// Already paying through Stripe: changes go through the customer portal so we
// never create a second subscription for the same workspace.
export const hasLiveStripeSubscription = (subscription: OrganisationSubscription | null) =>
  Boolean(subscription?.stripeSubscriptionId) && ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(subscription!.status);

export const checkoutLineItems = (plan: PlanId, requestedInterval: BillingInterval) => {
  const definition = PLANS[plan];
  if (!definition.selfServe) throw new HttpError(409, `${definition.name} is priced per firm. Book a demo and we'll send you a quote.`);
  const interval = intervalFor(plan, requestedInterval);
  // Pay as you go has no subscription fee, only the per-application price.
  const needsBase = plan !== 'payg';
  const base = needsBase ? stripeBasePriceIdFor(plan, interval) : null;
  const usage = stripeUsagePriceIdFor(plan);
  if ((needsBase && !base) || !usage) {
    throw new HttpError(503, `The ${definition.name} plan can't be bought online yet. Please contact us to subscribe.`);
  }
  // Metered prices take no quantity; Stripe bills what we report to the meter.
  return [...(base ? [{ price: base, quantity: 1 }] : []), { price: usage }];
};

export const startCheckout = async (auth: BillingAuth, plan: PlanId, interval: BillingInterval) => {
  assertCanManageBilling(auth);
  const subscription = auth.organisation.subscription;
  if (subscription?.status === 'COMPLIMENTARY') throw new HttpError(409, 'This workspace has complimentary access, so there is nothing to pay.');
  if (subscription?.status === 'SUSPENDED') throw new HttpError(403, 'This workspace has been suspended. Contact Architect Pro support.');
  if (hasLiveStripeSubscription(subscription)) return openBillingPortal(auth);

  const lineItems = checkoutLineItems(plan, interval);
  const session = await createCheckoutSession({
    organisationId: auth.organisation.id,
    lineItems,
    customerId: subscription?.stripeCustomerId ?? null,
    customerEmail: auth.user.email,
    successUrl: absoluteUrl('/billing?checkout=success'),
    cancelUrl: absoluteUrl('/billing?checkout=cancelled'),
  });
  if (!session.url) throw new HttpError(502, 'The payment provider did not return a checkout page.');
  return session.url;
};

export const openBillingPortal = async (auth: BillingAuth) => {
  assertCanManageBilling(auth);
  const customerId = auth.organisation.subscription?.stripeCustomerId;
  if (!customerId) throw new HttpError(409, 'There are no billing details for this workspace yet. Choose a plan first.');
  const session = await createPortalSession(customerId, absoluteUrl('/billing'));
  return session.url;
};
