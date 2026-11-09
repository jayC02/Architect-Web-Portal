export const prerender = false;

import type { APIRoute } from 'astro';
import { createGoogleAuthorizationUrl } from '@/lib/auth/oauth';
import { getSessionUser } from '@/lib/auth/session';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';

export const POST: APIRoute = context => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.oauth, 'google-connect');
  const user = await getSessionUser(context);
  if (!user) throw new HttpError(401, 'Sign in with your password before connecting Google.');
  return jsonResponse(200, { redirectTo: createGoogleAuthorizationUrl(context, '/settings/preferences', user.id) });
}, context);
