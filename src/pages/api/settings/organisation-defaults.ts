export const prerender = false;

import { OrganisationRole } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { organisationDefaultsSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation, requireOrganisationRole } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const defaults = await prisma.organisationDefaults.findUnique({
      where: { organisationId: organisation.id },
      include: { defaultCertifierPreset: true },
    });
    return jsonResponse(200, { defaults });
  }, context);

export const PUT: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'settings:organisation-defaults');
    const { organisation } = await requireOrganisationRole(context, [
      OrganisationRole.OWNER,
      OrganisationRole.ADMIN,
    ]);
    const body = await parseBody(context.request, organisationDefaultsSchema);

    if (body.defaultCertifierPresetId) {
      const preset = await prisma.organisationCertifierPreset.findFirst({
        where: { id: body.defaultCertifierPresetId, organisationId: organisation.id },
        select: { id: true },
      });
      if (!preset) throw new HttpError(400, 'The selected certifier preset is not available to this organisation.');
    }

    const defaults = await prisma.organisationDefaults.upsert({
      where: { organisationId: organisation.id },
      create: {
        ...body,
        organisationId: organisation.id,
      },
      update: body,
    });
    return jsonResponse(200, { defaults });
  }, context);
