export const prerender = false;

import { AutomationJobStatus, type Prisma } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { automationJobSnapshotV2Schema } from '@/lib/validation/automation-job';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { buildAutomationJobSnapshot } from '@/server/services/automation-jobs.service';
import { persistApplicationPreparationDraft } from '@/server/services/application-preparation.service';

const refreshableStatuses = [
  AutomationJobStatus.DRAFT,
  AutomationJobStatus.PREFLIGHT_REQUIRED,
  AutomationJobStatus.NEEDS_INPUT,
  AutomationJobStatus.READY,
  AutomationJobStatus.STALE,
  AutomationJobStatus.FAILED_RETRYABLE,
  AutomationJobStatus.FAILED,
];

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'automation-jobs:prepare');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Automation job id is required.');

    const job = await prisma.automationJob.findFirst({
      where: { id, organisationId: organisation.id, status: { in: refreshableStatuses } },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!job) throw new HttpError(409, 'Only unstarted, incomplete, stale or retryable jobs can be prepared again.');

    const previous = automationJobSnapshotV2Schema.safeParse(job.dataSnapshot);
    const snapshot = await buildAutomationJobSnapshot({
      jobId: job.id,
      organisationId: organisation.id,
      organisationName: organisation.name,
      projectId: job.projectId,
      type: job.type,
      createdBy: job.createdBy,
      createdAt: job.createdAt,
      sourceType: job.sourceType,
      planningApplicationId: previous.success ? previous.data.planning?.recordId ?? undefined : undefined,
      buildingWarrantApplicationId: previous.success ? previous.data.buildingWarrant?.recordId ?? undefined : undefined,
      documentIds: previous.success ? previous.data.documents.map((document) => document.id) : undefined,
    });

    const status = snapshot.preflight.status === 'READY'
      ? AutomationJobStatus.READY
      : AutomationJobStatus.NEEDS_INPUT;
    await prisma.automationJob.update({
      where: { id: job.id },
      data: {
        status,
        payloadVersion: 2,
        snapshotHash: snapshot.snapshotHash,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
        preparedAt: new Date(),
        reviewedAt: null,
        dataSnapshot: snapshot.dataSnapshot as Prisma.InputJsonValue,
        documentSnapshot: snapshot.documentSnapshot as Prisma.InputJsonValue,
        error: null,
      },
    });
    await persistApplicationPreparationDraft(job.id, organisation.id);

    return jsonResponse(200, {
      ok: true,
      status,
      preflight: snapshot.preflight,
      redirectTo: `/automation-job/${job.id}`,
    });
  }, context);
