export const prerender = false;

import { AutomationJobStatus, type Prisma } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { automationJobSnapshotV2Schema } from '@/lib/validation/automation-job';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import {
  buildDesktopLaunchUrl,
  createDesktopHandoffCode,
  desktopPortalOrigin,
  desktopHandoffCodeHash,
  desktopHandoffExpiry,
} from '@/server/auth/desktop-token';
import { requireOrganisation } from '@/server/permissions/authz';
import {
  buildAutomationJobSnapshot,
  currentAutomationSourceUpdatedAt,
} from '@/server/services/automation-jobs.service';
import { resolveAutomationJobIdentity } from '@/server/services/desktop-automation-status.service';
import {
  drainLifecycleEventsBestEffort,
  recordAutomationReadinessTransition,
} from '@/server/services/application-lifecycle.service';

const launchableStatuses = [
  AutomationJobStatus.READY,
  AutomationJobStatus.CLAIMED,
  AutomationJobStatus.IN_PROGRESS,
];

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'desktop-handoff:launch');
  const { organisation, user } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Automation job id is required.');

  const job = await prisma.automationJob.findFirst({
    where: { id, organisationId: organisation.id, status: { in: launchableStatuses } },
    select: {
      id: true,
      projectId: true,
      type: true,
      status: true,
      sourceType: true,
      claimedByUserId: true,
      payloadVersion: true,
      sourceUpdatedAt: true,
      dataSnapshot: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!job) throw new HttpError(409, 'This automation job cannot be opened or resumed.');
  if (job.status !== AutomationJobStatus.READY && job.claimedByUserId !== user.id) {
    throw new HttpError(409, 'This automation job is already open for another user.');
  }

  let identity;
  try {
    identity = resolveAutomationJobIdentity(job);
  } catch (error) {
    throw new HttpError(409, error instanceof Error ? error.message : 'This desktop job cannot be opened safely.');
  }
  const applicationExists = identity.applicationType === 'BUILDING_WARRANT'
    ? await prisma.buildingWarrantApplication.findFirst({
        where: { id: identity.applicationId, organisationId: organisation.id, projectId: job.projectId },
        select: { id: true },
      })
    : await prisma.planningApplication.findFirst({
        where: { id: identity.applicationId, organisationId: organisation.id, projectId: job.projectId },
        select: { id: true },
      });
  if (!applicationExists) {
    throw new HttpError(409, 'The application linked to this desktop job no longer exists in this Project.');
  }

  if (job.status === AutomationJobStatus.READY && job.payloadVersion >= 2) {
    const currentSource = await currentAutomationSourceUpdatedAt(
      organisation.id,
      job.projectId,
      job.dataSnapshot,
    );
    if (!currentSource || !job.sourceUpdatedAt || currentSource > job.sourceUpdatedAt) {
      const previous = automationJobSnapshotV2Schema.safeParse(job.dataSnapshot);
      if (!previous.success) {
        throw new HttpError(409, 'This prepared application is not compatible with snapshot v2. Prepare a new job.');
      }
      const refreshed = await buildAutomationJobSnapshot({
        jobId: job.id,
        organisationId: organisation.id,
        organisationName: organisation.name,
        projectId: job.projectId,
        type: job.type,
        createdBy: job.createdBy,
        createdAt: job.createdAt,
        sourceType: job.sourceType,
        planningApplicationId: previous.data.planning?.recordId ?? undefined,
        buildingWarrantApplicationId: previous.data.buildingWarrant?.recordId ?? undefined,
        documentIds: previous.data.documents.map((document) => document.id),
      });
      const refreshedStatus = refreshed.preflight.status === 'READY'
        ? AutomationJobStatus.READY
        : AutomationJobStatus.NEEDS_INPUT;
      const lifecycleEvent = await prisma.$transaction(async (tx) => {
        const refresh = await tx.automationJob.updateMany({
          where: { id: job.id, organisationId: organisation.id, status: AutomationJobStatus.READY },
          data: {
            title: refreshed.title,
            status: refreshedStatus,
            sourceType: refreshed.sourceType,
            payloadVersion: 2,
            snapshotHash: refreshed.snapshotHash,
            sourceUpdatedAt: refreshed.sourceUpdatedAt,
            preparedAt: new Date(),
            dataSnapshot: refreshed.dataSnapshot as Prisma.InputJsonValue,
            documentSnapshot: refreshed.documentSnapshot as Prisma.InputJsonValue,
            error: null,
          },
        });
        if (!refresh.count) throw new HttpError(409, 'This automation job changed while its latest details were being prepared. Retry safely.');
        return recordAutomationReadinessTransition(tx, {
          organisationId: organisation.id,
          projectId: job.projectId,
          jobType: job.type,
          previousStatus: job.status,
          nextStatus: refreshedStatus,
          readinessKey: refreshed.snapshotHash,
          planningApplicationId: refreshed.dataSnapshot.planning?.recordId,
          buildingWarrantApplicationId: refreshed.dataSnapshot.buildingWarrant?.recordId,
          actorUserId: user.id,
        });
      });
      await drainLifecycleEventsBestEffort(organisation.id, [lifecycleEvent?.id]);
      if (refreshedStatus !== AutomationJobStatus.READY) {
        throw new HttpError(409, 'Project information was refreshed, but required application details now need attention before desktop can open.');
      }
    }
  }

  const handoffCode = createDesktopHandoffCode();
  const updated = await prisma.automationJob.updateMany({
    where: { id, organisationId: organisation.id, status: job.status },
    data: {
      handoffCodeHash: desktopHandoffCodeHash(handoffCode),
      handoffExpiresAt: desktopHandoffExpiry(),
      handoffRedeemedAt: null,
      ...(job.status === AutomationJobStatus.READY ? { claimedByUserId: user.id } : {}),
    },
  });
  if (!updated.count) throw new HttpError(409, 'This automation job changed before it could be opened.');

  const launchMode = job.status === AutomationJobStatus.READY ? 'launch' : 'resume';
  console.info('Desktop automation handoff created.', {
    jobId: job.id,
    projectId: job.projectId,
    applicationType: identity.applicationType,
    applicationId: identity.applicationId,
    snapshotVersion: identity.snapshotVersion,
    status: job.status,
    launchMode,
    selectedAutomation: identity.applicationType === 'BUILDING_WARRANT' ? 'BUILDING_WARRANT' : 'PLANNING',
    selectedPreparationRoute: identity.applicationType === 'BUILDING_WARRANT'
      ? `/building-warrant/${identity.applicationId}/preparation`
      : `/planning/${identity.applicationId}/preparation`,
  });

  return jsonResponse(200, {
    launchUrl: buildDesktopLaunchUrl(id, handoffCode, desktopPortalOrigin(context.request)),
    launchMode,
  });
}, context);
