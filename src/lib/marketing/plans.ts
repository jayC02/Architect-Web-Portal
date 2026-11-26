import type { PlanId } from './routes';

// Agreed pricing. Prices are per practice, in GBP, excluding VAT.
// The pricing page, the plan finder, the features page and the FAQ all read from here.

export interface Plan {
  id: PlanId;
  name: string;
  /** Who the plan is for. */
  audience: string;
  /** Monthly price. For Firm this is the starting price. */
  monthly: number;
  /** Yearly price (two months free), 'quoted' for Firm, null when there is no yearly plan. */
  yearly: number | 'quoted' | null;
  /** Firm is priced from its monthly figure. */
  fromPrice?: boolean;
  /** Applications included each month. */
  included: number;
  /** Cost per included application, as shown. */
  perIncluded: string;
  /** Price of each application beyond those included, or null when agreed per firm. */
  extraRate: number | null;
  extraLabel: string;
  users: string;
  /** Most users allowed, or null for unlimited. */
  userLimit: number | null;
  uValues: string;
  support: string;
  highlight?: boolean;
  cta: 'subscribe' | 'talk';
}

export const plans: Plan[] = [
  {
    id: 'payg',
    name: 'Pay as you go',
    audience: 'For occasional jobs',
    monthly: 0,
    yearly: null,
    included: 0,
    perIncluded: '£29',
    extraRate: 29,
    extraLabel: '£29',
    users: '1',
    userLimit: 1,
    uValues: '£25 per project report',
    support: 'Email',
    cta: 'subscribe',
  },
  {
    id: 'practice',
    name: 'Practice',
    audience: 'For 1–3 person practices',
    monthly: 79,
    yearly: 790,
    included: 10,
    perIncluded: '£7.90',
    extraRate: 8,
    extraLabel: '£8',
    users: '3',
    userLimit: 3,
    uValues: '£19 a month add-on',
    support: 'Email',
    highlight: true,
    cta: 'subscribe',
  },
  {
    id: 'studio',
    name: 'Studio',
    audience: 'For busy practices',
    monthly: 179,
    yearly: 1790,
    included: 30,
    perIncluded: '£5.97',
    extraRate: 6,
    extraLabel: '£6',
    users: '10',
    userLimit: 10,
    uValues: 'Included',
    support: 'Priority',
    cta: 'subscribe',
  },
  {
    id: 'firm',
    name: 'Firm',
    audience: 'For 10+ staff',
    monthly: 399,
    yearly: 'quoted',
    fromPrice: true,
    included: 100,
    perIncluded: 'Under £4',
    extraRate: null,
    extraLabel: 'Agreed',
    users: 'Unlimited',
    userLimit: null,
    uValues: 'Included',
    support: 'Named contact and onboarding',
    cta: 'talk',
  },
];

/** Every plan includes the full workspace; plans differ in volume, users, U-values and support. */
export const everyPlanIncludes = [
  'Projects, clients, sites and deadlines',
  'AI document sorting',
  'Planning, building warrant and completion certificate preparation',
  'A licensed desktop Agent that completes the portal',
  'Gmail tracking of council and verifier replies',
  'Google Calendar sync and Xero overview',
];

export const pricingNotes = [
  'All prices are per practice, in pounds sterling, excluding VAT.',
  'Yearly plans are paid up front and cost the same as ten months, so two months are free.',
  'Statutory planning, building warrant and verifier fees are paid to the authority and are not included.',
];

export const formatPrice = (value: number) =>
  `£${value.toLocaleString('en-GB', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;

export const yearlySaving = (plan: Plan) => (typeof plan.yearly === 'number' ? plan.monthly * 12 - plan.yearly : 0);

/** Pay as you go price per application, for one-line summaries. */
export const payAsYouGoRate = plans[0].extraRate ?? 0;
/** Cheapest paid monthly plan, for one-line summaries. */
export const lowestPlanMonthly = Math.min(...plans.filter((plan) => plan.monthly > 0).map((plan) => plan.monthly));
