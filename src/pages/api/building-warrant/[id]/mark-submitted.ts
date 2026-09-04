export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { markApplicationSubmittedSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { confirmBuildingWarrantSubmitted } from '@/server/services/application-lifecycle.service';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'warrant:mark-submitted');
  const { organisation, user } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Building Warrant application id is required.');
  await parseBody(context.request, markApplicationSubmittedSchema);
  const result = await confirmBuildingWarrantSubmitted({
    organisationId: organisation.id,
    buildingWarrantApplicationId: id,
    actorUserId: user.id,
  });
  return jsonResponse(200, { ok: true, ...result });
}, context);
