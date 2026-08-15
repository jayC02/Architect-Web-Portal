export const prerender = false;

import type { APIRoute } from 'astro';
import { createXeroAuthorizationUrl } from '@/lib/xero/oauth';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { requireOrganisationRole } from '@/server/permissions/authz';

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.oauth, 'xero:connect');
  const { organisation, user } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  return context.redirect(await createXeroAuthorizationUrl(organisation.id, user.id));
}, context);
