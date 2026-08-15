export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { disconnectXeroOrganisation } from '@/lib/xero/oauth';
import { requireOrganisationRole } from '@/server/permissions/authz';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'xero:disconnect');
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  await disconnectXeroOrganisation(organisation.id);
  return jsonResponse(200, { ok: true });
}, context);
