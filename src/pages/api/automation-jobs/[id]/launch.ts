export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
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
import { currentAutomationSourceUpdatedAt } from '@/server/services/automation-jobs.service';
import { resolveAutomationJobIdentity } from '@/server/services/desktop-automation-status.service';

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
      claimedByUserId: true,
      payloadVersion: true,
      sourceUpdatedAt: true,
      dataSnapshot: true,
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
      await prisma.automationJob.updateMany({
        where: { id: job.id, organisationId: organisation.id, status: AutomationJobStatus.READY },
        data: { status: AutomationJobStatus.STALE },
      });
      throw new HttpError(409, 'Project information changed after this application was prepared. Prepare an updated job before opening the desktop app.');
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
