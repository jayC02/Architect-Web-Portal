// Commercial plans, matching the agreed pricing on the marketing site
// (src/lib/marketing/plans.ts). Prices live in Stripe; this file maps Stripe
// price ids (from env) to the plan and holds the limits the portal enforces.
export const PLAN_IDS = ['payg', 'practice', 'studio', 'firm'] as const;
export const BILLING_INTERVALS = ['monthly', 'annual'] as const;

export type PlanId = (typeof PLAN_IDS)[number];
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export type PlanDefinition = {
  id: PlanId;
  name: string;
  summary: string;
  /** Applications included each calendar month before per-application charges. */
  includedApplications: number;
  /** Charge per application beyond those included, in GBP; null when agreed per firm. */
  extraApplicationRate: number | null;
  /** Most users allowed, or null for unlimited. */
  userLimit: number | null;
  agentDeviceLimit: number;
  intervals: readonly BillingInterval[];
  /** Firm is quoted, so it goes through the demo form, not self-serve checkout. */
  selfServe: boolean;
};

export const PLANS: Record<PlanId, PlanDefinition> = {
  payg: {
    id: 'payg', name: 'Pay as you go', summary: 'No monthly fee. £29 per application. 1 user.',
    includedApplications: 0, extraApplicationRate: 29, userLimit: 1, agentDeviceLimit: 1,
    intervals: ['monthly'], selfServe: true,
  },
  practice: {
    id: 'practice', name: 'Practice', summary: '£79 a month. 10 applications included, then £8 each. 3 users.',
    includedApplications: 10, extraApplicationRate: 8, userLimit: 3, agentDeviceLimit: 3,
    intervals: ['monthly', 'annual'], selfServe: true,
  },
  studio: {
    id: 'studio', name: 'Studio', summary: '£179 a month. 30 applications included, then £6 each. 10 users.',
    includedApplications: 30, extraApplicationRate: 6, userLimit: 10, agentDeviceLimit: 10,
    intervals: ['monthly', 'annual'], selfServe: true,
  },
  firm: {
    id: 'firm', name: 'Firm', summary: 'From £399 a month. 100 applications included. Unlimited users. Quoted.',
    includedApplications: 100, extraApplicationRate: null, userLimit: null, agentDeviceLimit: 25,
    intervals: ['monthly', 'annual'], selfServe: false,
  },
};

export const SELF_SERVE_PLAN_IDS = PLAN_IDS.filter((id) => PLANS[id].selfServe);

export const TRIAL_DAYS = 14;
export const TRIAL_AGENT_DEVICE_LIMIT = 1;
export const COMPLIMENTARY_DEVICE_LIMIT = 10;

export const isPlanId = (value: unknown): value is PlanId =>
  typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);

export const isBillingInterval = (value: unknown): value is BillingInterval =>
  typeof value === 'string' && (BILLING_INTERVALS as readonly string[]).includes(value);

/** Pay as you go has no yearly option; anything unsupported falls back to monthly. */
export const intervalFor = (plan: PlanId, requested: unknown): BillingInterval =>
  isBillingInterval(requested) && PLANS[plan].intervals.includes(requested) ? requested : 'monthly';

const env = (name: string) => process.env[name]?.trim() || null;

/** Flat (licensed) price for the plan's subscription fee. Pay as you go has none. */
export const stripeBasePriceIdFor = (plan: PlanId, interval: BillingInterval) =>
  env(`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`);

/**
 * Metered per-application price, attached to the Stripe meter. The portal only
 * reports applications beyond the plan's monthly allowance, so this is a flat
 * per-unit price (£29, £8, £6).
 */
export const stripeUsagePriceIdFor = (plan: PlanId) => env(`STRIPE_PRICE_${plan.toUpperCase()}_USAGE`);

export const stripeMeterEventName = () => env('STRIPE_METER_EVENT_NAME') ?? 'application_submitted';

export const planForStripePrice = (priceId: string | null | undefined) => {
  if (!priceId) return null;
  for (const plan of PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      if (stripeBasePriceIdFor(plan, interval) === priceId) return { plan, interval, usage: false };
    }
    if (stripeUsagePriceIdFor(plan) === priceId) return { plan, interval: null, usage: true };
  }
  return null;
};

export const planLimits = (plan: PlanId) => ({
  plan,
  includedApplications: PLANS[plan].includedApplications,
  userLimit: PLANS[plan].userLimit,
  agentDeviceLimit: PLANS[plan].agentDeviceLimit,
});
