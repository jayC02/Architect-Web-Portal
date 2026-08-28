export const prerender = false;

import type { APIRoute } from 'astro';
import { createGoogleAuthorizationUrl } from '@/lib/auth/oauth';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';

export const GET: APIRoute = (context) => {
  try {
    assertRateLimit(context, rateLimitPolicies.oauth, 'google-start');
    return context.redirect(createGoogleAuthorizationUrl(context, context.url.searchParams.get('returnTo')));
  } catch (error) {
    console.error('Google authentication could not start.', error instanceof Error ? error.message : '');
    return context.redirect('/login?authError=google_unavailable');
  }
};
