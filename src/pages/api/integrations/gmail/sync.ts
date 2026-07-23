export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisationRole } from '@/server/permissions/authz';
import { syncOrganisationGmail } from '@/server/services/gmail-sync.service';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'gmail:sync');
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const result = await syncOrganisationGmail(organisation.id);
  return jsonResponse(200, { ok: true, ...result });
}, context);
