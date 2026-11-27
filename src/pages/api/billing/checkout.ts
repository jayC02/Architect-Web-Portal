export const prerender = false;

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { BILLING_INTERVALS, PLAN_IDS } from '@/config/plans';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { startCheckout } from '@/server/billing/checkout';

const checkoutSchema = z.object({ plan: z.enum(PLAN_IDS), billing: z.enum(BILLING_INTERVALS).default('monthly') });
// startCheckout rejects Firm (quoted) and falls back to monthly where a plan has no yearly option.

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'billing-checkout');
  const auth = await requireOrganisation(context);
  const body = await parseBody(context.request, checkoutSchema);
  return jsonResponse(200, { redirectTo: await startCheckout(auth, body.plan, body.billing) });
}, context);
