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
import { automationJobApplicationId } from '@/server/services/desktop-automation-status.service';
import { buildAutomationJobSnapshot } from '@/server/services/automation-jobs.service';

const refreshableStatuses = [
  AutomationJobStatus.DRAFT,
  AutomationJobStatus.PREFLIGHT_REQUIRED,
  AutomationJobStatus.NEEDS_INPUT,
  AutomationJobStatus.STALE,
  AutomationJobStatus.FAILED_RETRYABLE,
  AutomationJobStatus.FAILED,
];

const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'warrant:certifier-details');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Building warrant application id is required.');
    const body = await parseBody(context.request, buildingWarrantCertifierDetailsSchema);

    const application = await prisma.buildingWarrantApplication.findFirst({
      where: { id, organisationId: organisation.id },
      select: { id: true, projectId: true, preparationData: true },
    });
    if (!application) throw new HttpError(404, 'Building warrant application not found.');

    const job = await prisma.automationJob.findFirst({
      where: {
        id: body.jobId,
        organisationId: organisation.id,
        projectId: application.projectId,
        type: AutomationJobType.BUILDING_WARRANT,
        status: { in: refreshableStatuses },
      },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
    if (!job || automationJobApplicationId(job) !== application.id) {
      throw new HttpError(404, 'This preparation job is not available for the selected Building Warrant application.');
    }

    let preset = null;
    if (body.selectedCertifierPresetId) {
      preset = await prisma.organisationCertifierPreset.findFirst({
        where: { id: body.selectedCertifierPresetId, organisationId: organisation.id },
        select: {
          id: true,
          displayName: true,
          schemeType: true,
          registrationAPart2: true,
          registrationBPart2: true,
          certifierName: true,
          approvedBody: true,
        },
      });
      if (!preset) throw new HttpError(400, 'The selected certifier is not available to this organisation.');
    }

    const preparationData = jsonObject(application.preparationData);
    await prisma.buildingWarrantApplication.update({
      where: { id: application.id },
      data: {
        description: body.description,
        estimatedValue: body.estimatedValue,
        currentUse: body.currentUse,
        proposedUse: body.proposedUse,
        selectedCertifierPresetId: preset?.id ?? null,
        preparationData: {
          ...preparationData,
          certifier: {
            ...jsonObject(preparationData.certifier),
            presetId: preset?.id ?? null,
            displayName: preset?.displayName ?? null,
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
