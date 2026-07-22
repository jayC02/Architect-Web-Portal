export const prerender = false;

import type { APIRoute } from 'astro';
import { syncAllGoogleDeadlines } from '@/lib/integrations/google-calendar';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisationRole } from '@/server/permissions/authz';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'google-calendar:sync');
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const result = await syncAllGoogleDeadlines(organisation.id);
  return jsonResponse(200, { ok: true, ...result });
}, context);
