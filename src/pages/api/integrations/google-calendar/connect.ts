export const prerender = false;

import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import { createGoogleAuthorizationUrl, googleCalendarOAuthCookie } from '@/lib/integrations/google-calendar';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { requireOrganisationRole } from '@/server/permissions/authz';

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.mutation, 'google-calendar:connect');
  const { organisation, user } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const nonce = crypto.randomBytes(32).toString('base64url');
  context.cookies.set(googleCalendarOAuthCookie, nonce, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/api/integrations/google-calendar',
    maxAge: 10 * 60,
  });
  return context.redirect(createGoogleAuthorizationUrl({ organisationId: organisation.id, userId: user.id, nonce }));
}, context);
