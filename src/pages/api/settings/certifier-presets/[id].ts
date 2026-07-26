export const prerender = false;

import { OrganisationRole } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { certifierPresetSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisationRole } from '@/server/permissions/authz';

const requireId = (context: Parameters<APIRoute>[0]) => {
  if (!context.params.id) throw new HttpError(400, 'Certifier preset id is required.');
  return context.params.id;
};

export const PATCH: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'settings:certifier-presets:update');
    const { organisation } = await requireOrganisationRole(context, [
      OrganisationRole.OWNER,
      OrganisationRole.ADMIN,
    ]);
    const id = requireId(context);
    const body = await parseBody(context.request, certifierPresetSchema);

    const existing = await prisma.organisationCertifierPreset.findFirst({
      where: { id, organisationId: organisation.id },
      select: { id: true },
    });
    if (!existing) throw new HttpError(404, 'Certifier preset not found.');

    const preset = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.organisationCertifierPreset.updateMany({
          where: { organisationId: organisation.id, isDefault: true },
          data: { isDefault: false },
        });
      }
      const updated = await tx.organisationCertifierPreset.update({ where: { id }, data: body });
      if (body.isDefault) {
        await tx.organisationDefaults.upsert({
          where: { organisationId: organisation.id },
          create: { organisationId: organisation.id, defaultCertifierPresetId: id },
          update: { defaultCertifierPresetId: id },
        });
      }
      return updated;
    });
    return jsonResponse(200, { preset });
  }, context);

export const DELETE: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'settings:certifier-presets:delete');
    const { organisation } = await requireOrganisationRole(context, [
      OrganisationRole.OWNER,
      OrganisationRole.ADMIN,
    ]);
    const id = requireId(context);
    const result = await prisma.organisationCertifierPreset.deleteMany({
      where: { id, organisationId: organisation.id },
    });
    if (!result.count) throw new HttpError(404, 'Certifier preset not found.');
    return jsonResponse(200, { ok: true });
  }, context);
