export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisationRole } from '@/server/permissions/authz';
import { createXeroDraftForMilestone } from '@/server/services/xero-draft-invoices.service';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'finance:create-xero-draft');
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const result = await createXeroDraftForMilestone(organisation.id, context.params.id!);
  return jsonResponse(200, { ok: true, ...result });
}, context);
