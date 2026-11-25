export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { openBillingPortal } from '@/server/billing/checkout';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'billing-portal');
  const auth = await requireOrganisation(context);
  return jsonResponse(200, { redirectTo: await openBillingPortal(auth) });
}, context);
