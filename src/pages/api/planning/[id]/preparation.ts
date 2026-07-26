export const prerender = false;

import { PlanningStatus, type Prisma } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { householderPreparationUpdateSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const PATCH: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'planning:preparation');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Planning application id is required.');
    const body = await parseBody(context.request, householderPreparationUpdateSchema);
    const {
      description,
      discussedWithPlanningAuthority,
      treesOnOrAdjacentToSite,
      newOrAlteredVehicleAccess,
      currentParkingSpaces,
      proposedParkingSpaces,
      soleOwner,
      agriculturalHolding,
    } = body;
    const result = await prisma.planningApplication.updateMany({
      where: { id, organisationId: organisation.id },
      data: {
        description,
        preparationData: {
          discussedWithPlanningAuthority,
          treesOnOrAdjacentToSite,
          newOrAlteredVehicleAccess,
          currentParkingSpaces: newOrAlteredVehicleAccess ? currentParkingSpaces : undefined,
          proposedParkingSpaces: newOrAlteredVehicleAccess ? proposedParkingSpaces : undefined,
          soleOwner,
          agriculturalHolding,
        } as Prisma.InputJsonValue,
        status: PlanningStatus.DRAFTING,
        preparedAt: new Date(),
      },
    });
    if (!result.count) throw new HttpError(404, 'Planning application not found.');
    return jsonResponse(200, {
      ok: true,
      message: 'Application details saved. Prepare the job again to run preflight.',
    });
  }, context);
