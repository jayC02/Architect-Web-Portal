export const prerender = false;

import { Prisma } from '@prisma/client';
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { typeOfWorkKeysSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

const schema = z.object({ typeOfWorkKeys: typeOfWorkKeysSchema });
const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export const PATCH: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'warrant:type-of-work');
  const { organisation } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Building Warrant application id is required.');
  const body = await parseBody(context.request, schema);
  const application = await prisma.buildingWarrantApplication.findFirst({
    where: { id, organisationId: organisation.id },
    select: { id: true, preparationData: true },
  });
  if (!application) throw new HttpError(404, 'Building Warrant application not found.');
  const preparationData = objectValue(application.preparationData);
  await prisma.buildingWarrantApplication.updateMany({
    where: { id: application.id, organisationId: organisation.id },
    data: {
      presetKey: body.typeOfWorkKeys[0],
      preparationData: {
        ...preparationData,
        typeOfWorkKeys: body.typeOfWorkKeys,
      } as Prisma.InputJsonValue,
    },
  });
  return jsonResponse(200, { ok: true, typeOfWorkKeys: body.typeOfWorkKeys });
}, context);
