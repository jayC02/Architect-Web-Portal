import type { PlanId } from './routes';

// PLACEHOLDER PRICING. These figures are first-draft guesses for review, not
// agreed prices. Prices are per practice, in GBP, excluding VAT.

export interface Plan {
  id: PlanId;
  name: string;
  summary: string;
  monthly: number;
  /** Price per month when billed annually. */
  annualMonthly: number;
  seats: string;
  agentSeats: string;
  applications: string;
  highlight?: boolean;
  features: string[];
}

export const plans: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    summary: 'For sole practitioners running a handful of live projects.',
    monthly: 59,
    annualMonthly: 49,
    seats: '1 user',
    agentSeats: '1 desktop Agent',
    applications: 'Up to 10 automated submissions a month',
    features: [
      'Projects, clients, sites and deadlines',
      'Planning, building warrant and completion certificate preparation',
      'AI document sorting',
      'Google Calendar sync',
      'Email support',
    ],
  },
  {
    id: 'practice',
    name: 'Practice',
    summary: 'For small practices sharing projects across a team.',
    monthly: 149,
    annualMonthly: 124,
    seats: 'Up to 5 users',
    agentSeats: '3 desktop Agents',
    applications: 'Up to 40 automated submissions a month',
    highlight: true,
    features: [
      'Everything in Starter',
      'Gmail tracking of council and verifier replies',
      'Xero finance overview',
      'U-value calculator and reports',
      'Roles and permissions',
      'Priority email support',
    ],
  },
  {
    id: 'studio',
    name: 'Studio',
    summary: 'For growing studios with several teams and heavy application volume.',
    monthly: 349,
    annualMonthly: 291,
    seats: 'Up to 15 users',
    agentSeats: '10 desktop Agents',
    applications: 'Unlimited automated submissions',
    features: [
      'Everything in Practice',
      'Guided onboarding and data import',
      'Audit history for every submission',
      'Phone and video support',
    ],
  },
];

export const enterprise = {
  name: 'Enterprise',
  summary: 'For multi-office practices that need more seats, SSO or a custom agreement.',
  features: ['Unlimited users and Agents', 'Single sign-on', 'Data processing agreement', 'Named account manager'],
};

export const pricingNotes = [
  'Prices are per practice, in pounds sterling, excluding VAT.',
  'Annual billing is charged up front and saves roughly two months.',
  'Statutory planning, building warrant and verifier fees are paid to the authority and are not included.',
];

export const formatPrice = (value: number) => `£${value.toLocaleString('en-GB')}`;
