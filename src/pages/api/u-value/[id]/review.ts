export const prerender = false;
import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { reviewUValueCalculation } from '@/server/services/u-value-review.service';
export const POST: APIRoute = context => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'u-value:review');
  const { organisation, user } = await requireOrganisation(context);
  const event = await reviewUValueCalculation({ organisationId: organisation.id, userId: user.id, userName: user.name,
    calculationId: context.params.id!, body: await context.request.json().catch(() => ({})) });
  return jsonResponse(200, { event });
}, context);
