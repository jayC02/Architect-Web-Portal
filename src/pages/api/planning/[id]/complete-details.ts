export const prerender = false;

import { AutomationJobStatus, AutomationJobType, type Prisma } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { automationJobSnapshotV2Schema } from '@/lib/validation/automation-job';
import { planningPreparationDetailsSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { persistApplicationPreparationDraft } from '@/server/services/application-preparation.service';
import {
  drainLifecycleEventsBestEffort,
  recordAutomationReadinessTransition,
  updatePlanningApplicationWithLifecycle,
} from '@/server/services/application-lifecycle.service';
import { automationJobApplicationId } from '@/server/services/desktop-automation-status.service';
import { buildAutomationJobSnapshot } from '@/server/services/automation-jobs.service';

const refreshableStatuses = [
  AutomationJobStatus.DRAFT,
  AutomationJobStatus.PREFLIGHT_REQUIRED,
  AutomationJobStatus.NEEDS_INPUT,
  AutomationJobStatus.STALE,
];

const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'planning:complete-details');
  const { organisation, user } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Planning application id is required.');
  const body = await parseBody(context.request, planningPreparationDetailsSchema);

  const application = await prisma.planningApplication.findFirst({
    where: { id, organisationId: organisation.id },
    select: { id: true, projectId: true, preparationData: true },
  });
  if (!application) throw new HttpError(404, 'Planning application not found.');

  let job = body.jobId ? await prisma.automationJob.findFirst({
    where: {
      id: body.jobId,
      organisationId: organisation.id,
      projectId: application.projectId,
      type: { in: [AutomationJobType.HOUSEHOLDER_PLANNING, AutomationJobType.PLANNING_APPLICATION] },
      status: { in: refreshableStatuses },
    },
    include: { createdBy: { select: { id: true, name: true, email: true } } },
  }) : null;
  if (job && automationJobApplicationId(job) !== application.id) {
    job = null;
  }

  const {
    jobId: _jobId,
    applicationReference,
    submissionDate,
    validDate,
    decisionTargetDate,
    decisionDate,
    status: applicationStatus,
    portalUrl,
    notes,
    description,
    discussedWithPlanningAuthority,
    treesOnOrAdjacentToSite,
    newOrAlteredVehicleAccess,
    currentParkingSpaces,
    proposedParkingSpaces,
    soleOwner,
    agriculturalHolding,
  } = body;
  await updatePlanningApplicationWithLifecycle({
    organisationId: organisation.id,
    planningApplicationId: application.id,
    actorUserId: user.id,
    data: {
      applicationReference,
      submissionDate,
      validDate,
      decisionTargetDate,
      decisionDate,
      portalUrl,
      notes,
      description,
      preparationData: {
        ...jsonObject(application.preparationData),
        discussedWithPlanningAuthority,
        treesOnOrAdjacentToSite,
        newOrAlteredVehicleAccess,
        currentParkingSpaces: newOrAlteredVehicleAccess ? currentParkingSpaces : null,
        proposedParkingSpaces: newOrAlteredVehicleAccess ? proposedParkingSpaces : null,
        soleOwner,
        agriculturalHolding,
      } as Prisma.InputJsonValue,
      status: applicationStatus,
      preparedAt: new Date(),
    },
  });

  if (!job) {
    return jsonResponse(200, { ok: true, redirectTo: `/projects/${application.projectId}` });
  }

  const previous = automationJobSnapshotV2Schema.safeParse(job.dataSnapshot);
  const snapshot = await buildAutomationJobSnapshot({
    jobId: job.id,
    organisationId: organisation.id,
    organisationName: organisation.name,
    projectId: application.projectId,
    type: job.type,
    createdBy: job.createdBy,
    createdAt: job.createdAt,
    sourceType: job.sourceType,
    planningApplicationId: application.id,
    documentIds: previous.success ? previous.data.documents.map((document) => document.id) : undefined,
  });
  const status = snapshot.preflight.status === 'READY'
    ? AutomationJobStatus.READY
    : AutomationJobStatus.NEEDS_INPUT;
  const readinessLifecycleEvent = await prisma.$transaction(async (tx) => {
    await tx.automationJob.update({
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
    return recordAutomationReadinessTransition(tx, {
      organisationId: organisation.id,
      projectId: application.projectId,
      jobType: job.type,
      previousStatus: job.status,
      nextStatus: status,
      readinessKey: snapshot.snapshotHash,
      planningApplicationId: application.id,
      actorUserId: user.id,
    });
  });
  await persistApplicationPreparationDraft(job.id, organisation.id);
  await drainLifecycleEventsBestEffort(organisation.id, [readinessLifecycleEvent?.id]);

  return jsonResponse(200, {
    ok: true,
    status,
    preflight: snapshot.preflight,
    redirectTo: `/projects/${application.projectId}`,
  });
}, context);
