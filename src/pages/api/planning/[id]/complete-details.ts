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
import { authoriseAutomationJobRun } from '@/server/services/automation-job-run.service';
import { buildAutomationJobSnapshot } from '@/server/services/automation-jobs.service';

const refreshableStatuses = [
  AutomationJobStatus.DRAFT,
  AutomationJobStatus.PREFLIGHT_REQUIRED,
  AutomationJobStatus.NEEDS_INPUT,
  AutomationJobStatus.STALE,
  AutomationJobStatus.READY,
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
    applicationFee,
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
        applicationFee,
      } as Prisma.InputJsonValue,
      status: applicationStatus,
      preparedAt: new Date(),
    },
  });

  if (!job) {
    if (body.jobId) {
      throw new HttpError(409, 'Application details were saved, but this automation attempt is no longer available for preparation. Its snapshot was not changed. Return to the project to review the current attempt.', {
        applicationDetailsSaved: true,
        automationSnapshotUpdated: false,
      });
    }
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
    // A claim or another preparation save may win while the snapshot is built.
    // Enforce eligibility at the write boundary, not only at the earlier read.
    const refreshed = await tx.automationJob.updateMany({
      where: {
        id: job.id,
        organisationId: organisation.id,
        projectId: application.projectId,
        type: job.type,
        status: job.status,
        updatedAt: job.updatedAt,
        snapshotHash: job.snapshotHash,
        claimedAt: null,
        claimedDeviceId: null,
        claimedByUserId: null,
        claimedByAgentId: null,
        agentRunId: null,
        completedAt: null,
      },
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
    if (refreshed.count !== 1) {
      throw new HttpError(409, 'Application details were saved, but the automation attempt changed before its snapshot could be refreshed. The current attempt was not changed or requeued. Return to the project to review it.', {
        applicationDetailsSaved: true,
        automationSnapshotUpdated: false,
      });
    }
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

  const runResult = status === AutomationJobStatus.READY
    ? await authoriseAutomationJobRun({ organisationId: organisation.id, jobId: job.id })
    : null;

  return jsonResponse(200, {
    ok: true,
    status,
    preflight: snapshot.preflight,
    ...(runResult ? { queued: true, ...runResult } : {}),
    redirectTo: `/projects/${application.projectId}`,
  });
}, context);
