export const prerender = false;

import { AutomationJobStatus, type Prisma } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { automationJobCreateSchema, automationJobListQuerySchema } from '@/lib/validation/automation-job';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { withPerf } from '@/lib/utils/perf';
import { requireOrganisation, requireProjectAccess } from '@/server/permissions/authz';
import { buildAutomationJobSnapshot } from '@/server/services/automation-jobs.service';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const query = automationJobListQuerySchema.parse(Object.fromEntries(context.url.searchParams.entries()));
    const where: Prisma.AutomationJobWhereInput = {
      organisationId: organisation.id,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const jobs = await withPerf('api.automation-jobs.list', () =>
      prisma.automationJob.findMany({
        where,
        select: {
          id: true,
          type: true,
          status: true,
          sourceType: true,
          title: true,
          resultSummary: true,
          error: true,
          claimedAt: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
          project: { select: { id: true, name: true, internalReference: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          claimedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );

    return jsonResponse(200, { jobs });
  }, context);

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'automation-jobs:create');
    const { organisation, user } = await requireOrganisation(context);
    const body = await parseBody(context.request, automationJobCreateSchema);
    await requireProjectAccess(organisation.id, body.projectId);

    const snapshot = await buildAutomationJobSnapshot({
      organisationId: organisation.id,
      organisationName: organisation.name,
      projectId: body.projectId,
      type: body.type,
      sourceType: body.sourceType,
      planningApplicationId: body.planningApplicationId,
      buildingWarrantApplicationId: body.buildingWarrantApplicationId,
      documentSortBatchId: body.documentSortBatchId,
      documentIds: body.documentIds,
      notes: body.notes,
    });

    const job = await prisma.automationJob.create({
      data: {
        organisationId: organisation.id,
        projectId: body.projectId,
        type: body.type,
        status: AutomationJobStatus.DRAFT,
        sourceType: snapshot.sourceType,
        title: snapshot.title,
        dataSnapshot: snapshot.dataSnapshot as Prisma.InputJsonValue,
        documentSnapshot: snapshot.documentSnapshot as Prisma.InputJsonValue,
        createdById: user.id,
      },
      select: { id: true, title: true, status: true, type: true },
    });

    return jsonResponse(201, { job, redirectTo: '/automation-jobs' });
  }, context);
