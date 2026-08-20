export const prerender = false;

import { AutomationJobStatus, AutomationJobType, type Prisma } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { automationJobSnapshotV2Schema } from '@/lib/validation/automation-job';
import { buildingWarrantCertifierDetailsSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { persistApplicationPreparationDraft } from '@/server/services/application-preparation.service';
import {
  drainLifecycleEventsBestEffort,
  recordAutomationReadinessTransition,
} from '@/server/services/application-lifecycle.service';
import { findOrCreateCertifierProfile } from '@/server/services/certifier-presets.service';
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

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'warrant:certifier-details');
    const { organisation, user } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Building warrant application id is required.');
    const body = await parseBody(context.request, buildingWarrantCertifierDetailsSchema);

    const application = await prisma.buildingWarrantApplication.findFirst({
      where: { id, organisationId: organisation.id },
      select: { id: true, projectId: true, preparationData: true },
    });
    if (!application) throw new HttpError(404, 'Building warrant application not found.');

    const job = body.jobId ? await prisma.automationJob.findFirst({
      where: {
        id: body.jobId,
        organisationId: organisation.id,
        projectId: application.projectId,
        type: AutomationJobType.BUILDING_WARRANT,
        status: { in: refreshableStatuses },
      },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    }) : null;
    if (body.jobId && (!job || automationJobApplicationId(job) !== application.id)) {
      throw new HttpError(404, 'This preparation job is not available for the selected Building Warrant application.');
    }

    let selectedPreset = null;
    if (body.selectedCertifierPresetId) {
      selectedPreset = await prisma.organisationCertifierPreset.findFirst({
        where: { id: body.selectedCertifierPresetId, organisationId: organisation.id },
      });
      if (!selectedPreset) throw new HttpError(400, 'The selected certifier is not available to this organisation.');
    }

    const preset = await findOrCreateCertifierProfile(prisma, organisation.id, {
      schemeType: body.schemeType,
      registrationAPart1: body.registrationAPart1,
      registrationAPart2: body.registrationAPart2,
      certifierName: body.certifierName,
      registrationBPart1: body.registrationBPart1,
      registrationBPart2: body.registrationBPart2,
      approvedBody: body.approvedBody,
    });

    const preparationData = jsonObject(application.preparationData);
    await prisma.buildingWarrantApplication.update({
      where: { id: application.id },
      data: {
        warrantReference: body.warrantReference,
        warrantType: body.warrantType,
        submissionDate: body.submissionDate,
        firstResponseTargetDate: body.firstResponseTargetDate,
        grantedDate: body.grantedDate,
        expiryDate: body.expiryDate,
        completionCertificateStatus: body.completionCertificateStatus,
        status: body.status,
        portalUrl: body.portalUrl,
        notes: body.notes,
        presetKey: body.typeOfWorkKeys[0],
        description: body.description,
        estimatedValue: body.estimatedValue,
        currentUse: body.currentUse,
        proposedUse: body.proposedUse,
        selectedCertifierPresetId: preset.id,
        preparationData: {
          ...preparationData,
          typeOfWorkKeys: body.typeOfWorkKeys,
          applicantIsOwner: body.applicantIsOwner,
          applicationIsStaged: body.applicationIsStaged,
          intendedLifeFiveYearsOrLess: body.intendedLifeFiveYearsOrLess,
          fireAndRescueServiceEnforcingAuthority: body.fireAndRescueServiceEnforcingAuthority,
          listedBuildingOrConservationArea: body.listedBuildingOrConservationArea,
          otherHistoricalImportance: body.otherHistoricalImportance,
          scottishMinistersRelaxationDirection: body.scottishMinistersRelaxationDirection,
          dangerousBuildingNotice: body.dangerousBuildingNotice,
          approvedCertifierOfConstruction: body.approvedCertifierOfConstruction,
          coveredBySTAS: body.coveredBySTAS,
          restrictPublicInspection: body.restrictPublicInspection,
          certifier: {
            ...jsonObject(preparationData.certifier),
            presetId: preset.id,
            displayName: preset.displayName,
            schemeType: body.schemeType ?? null,
            registrationAPart1: body.registrationAPart1,
            registrationAPart2: body.registrationAPart2,
            certifierName: body.certifierName,
            registrationBPart1: body.registrationBPart1,
            registrationBPart2: body.registrationBPart2,
            approvedBody: body.approvedBody,
          },
        } as Prisma.InputJsonValue,
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
      buildingWarrantApplicationId: application.id,
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
        buildingWarrantApplicationId: application.id,
        actorUserId: user.id,
      });
    });
    await persistApplicationPreparationDraft(job.id, organisation.id);
    await drainLifecycleEventsBestEffort(organisation.id, [readinessLifecycleEvent?.id]);

    const preparationRedirect = `/building-warrant/${encodeURIComponent(application.id)}/preparation?job=${encodeURIComponent(job.id)}&incomplete=1`;
    return jsonResponse(200, {
      ok: true,
      status,
      preflight: snapshot.preflight,
      redirectTo: status === AutomationJobStatus.READY
        ? `/projects/${application.projectId}`
        : preparationRedirect,
    });
  }, context);
