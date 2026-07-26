export const prerender = false;

import { OrganisationRole } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { certifierPresetSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisation, requireOrganisationRole } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const certifierPresets = await prisma.organisationCertifierPreset.findMany({
      where: { organisationId: organisation.id },
      orderBy: [{ isDefault: 'desc' }, { displayName: 'asc' }],
    });
    return jsonResponse(200, { certifierPresets });
  }, context);

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'settings:certifier-presets:create');
    const { organisation } = await requireOrganisationRole(context, [
      OrganisationRole.OWNER,
      OrganisationRole.ADMIN,
    ]);
    const body = await parseBody(context.request, certifierPresetSchema);

    const preset = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.organisationCertifierPreset.updateMany({
          where: { organisationId: organisation.id, isDefault: true },
          data: { isDefault: false },
        });
      }
      const created = await tx.organisationCertifierPreset.create({
        data: { ...body, organisationId: organisation.id },
      });
      if (body.isDefault) {
        await tx.organisationDefaults.upsert({
          where: { organisationId: organisation.id },
          create: { organisationId: organisation.id, defaultCertifierPresetId: created.id },
          update: { defaultCertifierPresetId: created.id },
        });
      }
      return created;
    });

    return jsonResponse(201, { preset });
  }, context);
