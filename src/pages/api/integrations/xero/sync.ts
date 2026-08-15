export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { syncXeroOrganisation } from '@/lib/xero/sync';
import { requireOrganisationRole } from '@/server/permissions/authz';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'xero:sync');
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  return jsonResponse(200, { ok: true, ...(await syncXeroOrganisation(organisation.id)) });
}, context);
