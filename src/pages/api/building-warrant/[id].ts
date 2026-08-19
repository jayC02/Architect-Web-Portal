export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { buildingWarrantSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { updateBuildingWarrantWithLifecycle } from '@/server/services/application-lifecycle.service';

export const PATCH: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'warrant:update');
    const { organisation, user } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Building warrant application id is required.');
    const body = await parseBody(context.request, buildingWarrantSchema);
    await updateBuildingWarrantWithLifecycle({
      organisationId: organisation.id,
      buildingWarrantApplicationId: id,
      actorUserId: user.id,
      data: body,
    });
    return jsonResponse(200, { ok: true });
  });

export const DELETE: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'warrant:delete');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Building warrant application id is required.');
    const result = await prisma.buildingWarrantApplication.deleteMany({
      where: { id, organisationId: organisation.id },
    });
    if (!result.count) throw new HttpError(404, 'Building warrant application not found.');
    return jsonResponse(200, { ok: true });
  }, context);
