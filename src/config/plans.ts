// Commercial plans. Prices live in Stripe; this file only maps Stripe price ids
// (from env) to the plan and the limits the portal enforces.
export const PLAN_IDS = ['starter', 'practice', 'studio'] as const;
export const BILLING_INTERVALS = ['monthly', 'annual'] as const;

export type PlanId = (typeof PLAN_IDS)[number];
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export type PlanDefinition = {
  id: PlanId;
  name: string;
  summary: string;
  agentDeviceLimit: number;
};

export const PLANS: Record<PlanId, PlanDefinition> = {
  starter: { id: 'starter', name: 'Starter', summary: 'For sole practitioners. One Agent computer.', agentDeviceLimit: 1 },
  practice: { id: 'practice', name: 'Practice', summary: 'For small practices. Up to three Agent computers.', agentDeviceLimit: 3 },
  studio: { id: 'studio', name: 'Studio', summary: 'For larger studios. Up to ten Agent computers.', agentDeviceLimit: 10 },
};

export const TRIAL_DAYS = 14;
export const TRIAL_AGENT_DEVICE_LIMIT = 1;
export const COMPLIMENTARY_DEVICE_LIMIT = 10;

export const isPlanId = (value: unknown): value is PlanId =>
  typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);

export const isBillingInterval = (value: unknown): value is BillingInterval =>
  typeof value === 'string' && (BILLING_INTERVALS as readonly string[]).includes(value);

const priceEnvName = (plan: PlanId, interval: BillingInterval) =>
  `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`;

export const stripePriceIdFor = (plan: PlanId, interval: BillingInterval) =>
  process.env[priceEnvName(plan, interval)]?.trim() || null;

export const planForStripePrice = (priceId: string | null | undefined) => {
  if (!priceId) return null;
  for (const plan of PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      if (stripePriceIdFor(plan, interval) === priceId) return { plan, interval };
    }
  }
  return null;
};
