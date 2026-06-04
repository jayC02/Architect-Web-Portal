export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { planningApplicationSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const PATCH: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'planning:update');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Planning application id is required.');
    const body = await parseBody(context.request, planningApplicationSchema);
    const result = await prisma.planningApplication.updateMany({
      where: { id, organisationId: organisation.id },
      data: body,
    });
    if (!result.count) throw new HttpError(404, 'Planning application not found.');
    return jsonResponse(200, { ok: true });
  });
