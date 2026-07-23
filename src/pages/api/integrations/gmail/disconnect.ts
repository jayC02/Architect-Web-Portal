export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisationRole } from '@/server/permissions/authz';
import { disconnectGmailTracking } from '@/server/services/gmail-sync.service';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'gmail:disconnect');
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  await disconnectGmailTracking(organisation.id);
  return jsonResponse(200, { ok: true });
}, context);
