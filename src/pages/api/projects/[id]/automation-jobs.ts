export const prerender = false;

import { AutomationJobStatus, type Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { desktopJobCreateSchema } from '@/lib/validation/desktop-handoff';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation, requireProjectAccess } from '@/server/permissions/authz';
import {
  buildAutomationJobSnapshot,
  ensureAutomationApplicationRecord,
} from '@/server/services/automation-jobs.service';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'desktop-handoff:create');
  const { organisation, user } = await requireOrganisation(context);
  const projectId = context.params.id;
  if (!projectId) throw new HttpError(400, 'Project id is required.');
  await requireProjectAccess(organisation.id, projectId);
  const body = await parseBody(context.request, desktopJobCreateSchema);
  const existing = await prisma.automationJob.findFirst({
    where: {
      organisationId: organisation.id,
      projectId,
      type: body.type,
      status: {
        in: [
          AutomationJobStatus.DRAFT,
          AutomationJobStatus.PREFLIGHT_REQUIRED,
          AutomationJobStatus.NEEDS_INPUT,
          AutomationJobStatus.READY,
          AutomationJobStatus.STALE,
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, type: true, status: true },
  });
  if (existing) {
    return jsonResponse(200, { job: existing, redirectTo: `/automation-job/${existing.id}` });
  }

  const applicationRecord = await ensureAutomationApplicationRecord(organisation.id, projectId, body.type);
  const jobId = randomUUID();

  const snapshot = await buildAutomationJobSnapshot({
    jobId,
    organisationId: organisation.id,
    organisationName: organisation.name,
    projectId,
    type: body.type,
    createdBy: { id: user.id, name: user.name, email: user.email },
    planningApplicationId: body.planningApplicationId ?? applicationRecord.planningApplicationId,
    buildingWarrantApplicationId: body.buildingWarrantApplicationId ?? applicationRecord.buildingWarrantApplicationId,
  });
  const job = await prisma.automationJob.create({
    data: {
      id: jobId,
      organisationId: organisation.id,
      projectId,
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
    select: { id: true, title: true, type: true, status: true },
  });

  return jsonResponse(201, {
    job,
    redirectTo: `/automation-job/${job.id}`,
  });
}, context);
