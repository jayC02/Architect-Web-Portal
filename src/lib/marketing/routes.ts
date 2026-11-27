// Every call to action on the public website points through these constants.
// Access is gated: visitors either book a demo (and are approved) or start a paid
// subscription. Nothing on the marketing site links to an open download or free signup.
// The subscription and access-request routes are owned by the access-gating work;
// change them here if those routes are renamed.

export const marketingRoutes = {
  home: '/',
  features: '/features',
  /** The 3D scroll story: one project from first sketch to completion. */
  liveDemo: '/live-demo',
  pricing: '/pricing',
  demo: '/demo',
  security: '/security',
  about: '/about',
  contact: '/contact',
  faq: '/faq',
  privacy: '/privacy',
  terms: '/terms',
  signIn: '/login',
  /** POST endpoint that records a demo or access request for review. */
  accessRequestApi: '/api/access-requests',
} as const;

export type PlanId = 'payg' | 'practice' | 'studio' | 'firm';
export type BillingPeriod = 'monthly' | 'annual';

export const subscribeHref = (plan: PlanId, billing: BillingPeriod = 'monthly') =>
  `/subscribe?plan=${plan}&billing=${billing}`;

export const demoHref = (interest?: string) =>
  interest ? `${marketingRoutes.demo}?interest=${encodeURIComponent(interest)}` : marketingRoutes.demo;

export const primaryNav = [
  { label: 'Features', href: marketingRoutes.features },
  { label: 'Live demo', href: marketingRoutes.liveDemo },
  { label: 'Pricing', href: marketingRoutes.pricing },
  { label: 'Security', href: marketingRoutes.security },
  { label: 'About', href: marketingRoutes.about },
  { label: 'FAQ', href: marketingRoutes.faq },
] as const;

/** Placeholder contact details. Replace before launch. */
export const contactDetails = {
  salesEmail: 'hello@architectpro.example',
  supportEmail: 'support@architectpro.example',
  location: 'Scotland, United Kingdom',
} as const;
