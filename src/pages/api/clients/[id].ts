export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { clientSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const PATCH: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'clients:update');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Client id is required.');
    const body = await parseBody(context.request, clientSchema);
    const result = await prisma.client.updateMany({
      where: { id, organisationId: organisation.id },
      data: body,
    });
    if (!result.count) throw new HttpError(404, 'Client not found.');
    return jsonResponse(200, { ok: true });
  });

export const DELETE: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'clients:delete');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Client id is required.');
    const result = await prisma.client.deleteMany({ where: { id, organisationId: organisation.id } });
    if (!result.count) throw new HttpError(404, 'Client not found.');
    return jsonResponse(200, { ok: true });
  });
