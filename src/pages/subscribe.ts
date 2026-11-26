export const prerender = false;

import type { APIRoute } from 'astro';
import { intervalFor, isPlanId, PLANS } from '@/config/plans';
import { getSessionAuth } from '@/lib/auth/session';
import { HttpError } from '@/lib/utils/http';
import { startCheckout } from '@/server/billing/checkout';

// Entry point for the pricing page's "Start subscription" buttons.
// Signed out -> register (carrying the plan) -> back here -> Stripe Checkout.
export const GET: APIRoute = async (context) => {
  const params = context.url.searchParams;
  const plan = isPlanId(params.get('plan')) ? params.get('plan')! : null;
  const headers = { 'Cache-Control': 'no-store' };
  if (!plan) return context.redirect('/pricing');
  // Firm is quoted, so it goes to the demo form rather than checkout.
  if (!PLANS[plan as keyof typeof PLANS].selfServe) return context.redirect('/demo?interest=firm');
  const billing = intervalFor(plan as never, params.get('billing'));

  const auth = await getSessionAuth(context);
  if (!auth) return context.redirect(`/register?plan=${plan}&billing=${billing}`);

  try {
    const url = await startCheckout(auth, plan as never, billing as never);
    return new Response(null, { status: 303, headers: { ...headers, Location: url } });
  } catch (error) {
    const message = error instanceof HttpError ? error.message : 'We could not start checkout. Please try again.';
    if (!(error instanceof HttpError)) console.error(error);
    return context.redirect(`/billing?error=${encodeURIComponent(message)}`);
  }
};
