export const prerender = false;

import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import { createGoogleAuthorizationUrl } from '@/lib/integrations/google-calendar';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { requireOrganisationRole } from '@/server/permissions/authz';

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.mutation, 'google-calendar:connect');
  const { organisation, user } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const nonce = crypto.randomBytes(32).toString('base64url');
  return context.redirect(createGoogleAuthorizationUrl({ organisationId: organisation.id, userId: user.id, nonce }));
}, context);
