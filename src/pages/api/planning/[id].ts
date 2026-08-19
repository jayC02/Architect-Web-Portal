export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { planningApplicationSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { updatePlanningApplicationWithLifecycle } from '@/server/services/application-lifecycle.service';

export const PATCH: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'planning:update');
    const { organisation, user } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Planning application id is required.');
    const body = await parseBody(context.request, planningApplicationSchema);
    await updatePlanningApplicationWithLifecycle({
      organisationId: organisation.id,
      planningApplicationId: id,
      actorUserId: user.id,
      data: body,
    });
    return jsonResponse(200, { ok: true });
  }, context);

export const DELETE: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'planning:delete');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Planning application id is required.');
    const result = await prisma.planningApplication.deleteMany({
      where: { id, organisationId: organisation.id },
    });
    if (!result.count) throw new HttpError(404, 'Planning application not found.');
    return jsonResponse(200, { ok: true });
  }, context);
