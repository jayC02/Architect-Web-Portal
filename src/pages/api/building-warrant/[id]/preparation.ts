import { readProjectScreener } from '@/lib/projects/screener';
import { warrantBranchesFromForm, warrantBranchFormFields } from '@/lib/building-warrant-branches';
import { ownerFromForm, ownerFormFields } from '@/lib/building-warrant-owner';
import { sustainabilityFromForm, warrantFollowUpFormFields } from '@/lib/building-warrant-follow-ups';
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
      typeOfWorkKeys,
      selectedCertifierPresetId,
      ...unusualAnswers
    } = body;
    const application = await prisma.buildingWarrantApplication.findFirst({
      where: { id, organisationId: organisation.id },
      select: { id: true, preparationData: true, project: { select: { buildingUse: true, typeOfWorkKeys: true, projectType: true } } },
    });
    if (!application) throw new HttpError(404, 'Building warrant application not found.');
    const projectScreen = readProjectScreener(application.project ?? {});
    const effectiveWorkTypes = projectScreen.typeOfWorkKeys.length ? projectScreen.typeOfWorkKeys : body.typeOfWorkKeys;
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
    const savedAnswers = Object.fromEntries(
      Object.entries(unusualAnswers).filter(([key, value]) => !(key in warrantBranchFormFields) && !(key in warrantFollowUpFormFields) && !(key in ownerFormFields) && value !== undefined),
    );
    await prisma.buildingWarrantApplication.update({
      where: { id: application.id },
      data: {
        description,
        estimatedValue,
        currentUse,
        proposedUse,
        presetKey: effectiveWorkTypes[0],
        selectedCertifierPresetId: selectedCertifierPresetId ?? null,
        preparationData: {
          ...existingPreparation,
          typeOfWorkKeys: effectiveWorkTypes,
          ...savedAnswers,
          ...(body.designCertifierSelected === false ? { certifier: null, certifierOfDesignCertificateAvailable: false } : {}),
          ...(!body.approvedCertifierOfConstruction ? { certifierOfConstructionCertificateAvailable: false } : {}),
          ...warrantBranchesFromForm(body),
          declarationAuthorised: body.declarationAuthorised,
          ...(body.designCertifierSelected !== undefined ? { designCertifierSelected: body.designCertifierSelected } : {}),
          ownerIsClient: body.ownerIsClient ?? null,
          ownerDetails: body.ownerIsClient === false ? ownerFromForm(body) : existingPreparation.ownerDetails ?? {},
          fireAuthorityName: body.fireAuthorityName ?? null,
          historicalBuildingDetails: body.historicalBuildingDetails ?? null,
          dangerousBuildingReferences: body.dangerousBuildingReferences ?? null,
          relaxationReference: body.relaxationReferences[0] || body.relaxationReference || null,
          relaxationDate: body.relaxationDates[0] || body.relaxationDate || null,
          sustainability: sustainabilityFromForm(body),
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
