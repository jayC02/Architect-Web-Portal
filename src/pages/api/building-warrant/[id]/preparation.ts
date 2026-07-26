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

    if (body.selectedCertifierPresetId) {
      const preset = await prisma.organisationCertifierPreset.findFirst({
        where: { id: body.selectedCertifierPresetId, organisationId: organisation.id },
        select: { id: true },
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
    const result = await prisma.buildingWarrantApplication.updateMany({
      where: { id, organisationId: organisation.id },
      data: {
        description,
        estimatedValue,
        currentUse,
        proposedUse,
        presetKey,
        selectedCertifierPresetId: selectedCertifierPresetId ?? null,
        preparationData: unusualAnswers as Prisma.InputJsonValue,
        status: WarrantStatus.DRAFTING,
        preparedAt: new Date(),
      },
    });
    if (!result.count) throw new HttpError(404, 'Building warrant application not found.');
    return jsonResponse(200, {
      ok: true,
      message: 'Application details saved. Prepare the job again to run preflight.',
    });
  }, context);
