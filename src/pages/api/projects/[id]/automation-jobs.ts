export const prerender = false;

import { AutomationJobStatus, type Prisma } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { desktopJobCreateSchema } from '@/lib/validation/desktop-handoff';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation, requireProjectAccess } from '@/server/permissions/authz';
import { buildAutomationJobSnapshot } from '@/server/services/automation-jobs.service';
import {
  buildDesktopLaunchUrl,
  createDesktopHandoffCode,
  desktopPortalOrigin,
  desktopHandoffCodeHash,
  desktopHandoffExpiry,
} from '@/server/auth/desktop-token';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'desktop-handoff:create');
  const { organisation, user } = await requireOrganisation(context);
  const projectId = context.params.id;
  if (!projectId) throw new HttpError(400, 'Project id is required.');
  await requireProjectAccess(organisation.id, projectId);
  const body = await parseBody(context.request, desktopJobCreateSchema);

  const snapshot = await buildAutomationJobSnapshot({
    organisationId: organisation.id,
    organisationName: organisation.name,
    projectId,
    type: body.type,
    planningApplicationId: body.planningApplicationId,
    buildingWarrantApplicationId: body.buildingWarrantApplicationId,
  });
  const handoffCode = createDesktopHandoffCode();
  const job = await prisma.automationJob.create({
    data: {
      organisationId: organisation.id,
      projectId,
      type: body.type,
      status: AutomationJobStatus.READY,
      sourceType: snapshot.sourceType,
      title: snapshot.title,
      payloadVersion: 1,
      handoffCodeHash: desktopHandoffCodeHash(handoffCode),
      handoffExpiresAt: desktopHandoffExpiry(),
      dataSnapshot: snapshot.dataSnapshot as Prisma.InputJsonValue,
      documentSnapshot: snapshot.documentSnapshot as Prisma.InputJsonValue,
      createdById: user.id,
    },
    select: { id: true, title: true, type: true, status: true },
  });

  return jsonResponse(201, {
    job,
    launchUrl: buildDesktopLaunchUrl(job.id, handoffCode, desktopPortalOrigin(context.request)),
  });
}, context);
