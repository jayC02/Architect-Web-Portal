export const prerender = false;

import { WarrantStatus, type Prisma } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { buildingWarrantPreparationUpdateSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const PATCH: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'warrant:preparation');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Building warrant application id is required.');
    const body = await parseBody(context.request, buildingWarrantPreparationUpdateSchema);

    let preset = null;
    if (body.selectedCertifierPresetId) {
      preset = await prisma.organisationCertifierPreset.findFirst({
        where: { id: body.selectedCertifierPresetId, organisationId: organisation.id },
        select: {
          id: true,
          displayName: true,
          schemeType: true,
          registrationAPart1: true,
          registrationAPart2: true,
          registrationBPart1: true,
          registrationBPart2: true,
          certifierName: true,
          approvedBody: true,
        },
      });
      if (!preset) throw new HttpError(400, 'The selected certifier is not available to this organisation.');
    }

    const {
      description,
      estimatedValue,
      currentUse,
      proposedUse,
      presetKey,
      selectedCertifierPresetId,
      ...unusualAnswers
    } = body;
    const application = await prisma.buildingWarrantApplication.findFirst({
      where: { id, organisationId: organisation.id },
      select: { id: true, preparationData: true },
    });
    if (!application) throw new HttpError(404, 'Building warrant application not found.');
    const existingPreparation = application.preparationData
      && typeof application.preparationData === 'object'
      && !Array.isArray(application.preparationData)
      ? application.preparationData as Prisma.JsonObject
      : {};
    const existingCertifier = existingPreparation.certifier
      && typeof existingPreparation.certifier === 'object'
      && !Array.isArray(existingPreparation.certifier)
      ? existingPreparation.certifier as Prisma.JsonObject
      : {};
    await prisma.buildingWarrantApplication.update({
      where: { id: application.id },
      data: {
        description,
        estimatedValue,
        currentUse,
        proposedUse,
        presetKey,
        selectedCertifierPresetId: selectedCertifierPresetId ?? null,
        preparationData: {
          ...existingPreparation,
          ...unusualAnswers,
          ...(preset ? {
            certifier: {
              ...existingCertifier,
              presetId: preset.id,
              displayName: preset.displayName,
              schemeType: preset.schemeType,
              registrationAPart1: preset.registrationAPart1,
              registrationAPart2: preset.registrationAPart2,
              registrationBPart1: preset.registrationBPart1,
              registrationBPart2: preset.registrationBPart2,
              certifierName: preset.certifierName,
              approvedBody: preset.approvedBody,
            },
          } : {}),
        } as Prisma.InputJsonValue,
        status: WarrantStatus.DRAFTING,
        preparedAt: new Date(),
      },
    });
    return jsonResponse(200, {
      ok: true,
      message: 'Application details saved. Prepare the job again to run preflight.',
    });
  }, context);
