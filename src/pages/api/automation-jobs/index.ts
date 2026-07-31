export const prerender = false;

import { AutomationJobStatus, type Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { automationJobCreateSchema, automationJobListQuerySchema } from '@/lib/validation/automation-job';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { withPerf } from '@/lib/utils/perf';
import { requireOrganisation, requireProjectAccess } from '@/server/permissions/authz';
import {
  buildAutomationJobSnapshot,
  resolveAutomationApplicationRecord,
} from '@/server/services/automation-jobs.service';
import { findReusableAutomationJob } from '@/server/services/desktop-automation-status.service';

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
    const applicationRecord = await resolveAutomationApplicationRecord(
      organisation.id,
      body.projectId,
      body.type,
      body,
    );
    const applicationId = applicationRecord.planningApplicationId
      ?? applicationRecord.buildingWarrantApplicationId;
    const existing = await findReusableAutomationJob({
      organisationId: organisation.id,
      projectId: body.projectId,
      type: body.type,
      applicationId,
    });
    if (existing) return jsonResponse(200, { job: existing, redirectTo: `/automation-job/${existing.id}` });

    const jobId = randomUUID();
    const snapshot = await buildAutomationJobSnapshot({
      jobId,
      organisationId: organisation.id,
      organisationName: organisation.name,
      projectId: body.projectId,
      type: body.type,
      createdBy: { id: user.id, name: user.name, email: user.email },
      sourceType: body.sourceType,
      planningApplicationId: body.planningApplicationId ?? applicationRecord.planningApplicationId,
      buildingWarrantApplicationId: body.buildingWarrantApplicationId ?? applicationRecord.buildingWarrantApplicationId,
      documentSortBatchId: body.documentSortBatchId,
      documentIds: body.documentIds,
      notes: body.notes,
    });
    const preparedWhileBuilding = await findReusableAutomationJob({
      organisationId: organisation.id,
      projectId: body.projectId,
      type: body.type,
      applicationId,
    });
    if (preparedWhileBuilding) {
      return jsonResponse(200, {
        job: preparedWhileBuilding,
        redirectTo: `/automation-job/${preparedWhileBuilding.id}`,
      });
    }

    const job = await prisma.automationJob.create({
      data: {
        id: jobId,
        organisationId: organisation.id,
        projectId: body.projectId,
        type: body.type,
        status: snapshot.preflight.status === 'READY'
          ? AutomationJobStatus.PREFLIGHT_REQUIRED
          : AutomationJobStatus.NEEDS_INPUT,
        sourceType: snapshot.sourceType,
        title: snapshot.title,
        payloadVersion: 2,
        snapshotHash: snapshot.snapshotHash,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
        preparedAt: new Date(),
        dataSnapshot: snapshot.dataSnapshot as Prisma.InputJsonValue,
        documentSnapshot: snapshot.documentSnapshot as Prisma.InputJsonValue,
        createdById: user.id,
      },
      select: { id: true, title: true, status: true, type: true },
    });

    return jsonResponse(201, { job, redirectTo: `/automation-job/${job.id}` });
  }, context);
