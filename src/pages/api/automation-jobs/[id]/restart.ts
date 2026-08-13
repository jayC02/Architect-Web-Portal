export const prerender = false;

import { randomUUID } from 'node:crypto';
import {
  AutomationJobStatus,
  AutomationJobType,
  type Prisma,
} from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { persistApplicationPreparationDraft } from '@/server/services/application-preparation.service';
import { buildAutomationJobSnapshot } from '@/server/services/automation-jobs.service';
import {
  findReusableAutomationJob,
  resolveAutomationJobIdentity,
} from '@/server/services/desktop-automation-status.service';

const planningTypes = new Set<AutomationJobType>([
  AutomationJobType.HOUSEHOLDER_PLANNING,
  AutomationJobType.PLANNING_APPLICATION,
]);

const cancellableStatuses = new Set<AutomationJobStatus>([
  AutomationJobStatus.DRAFT,
  AutomationJobStatus.PREFLIGHT_REQUIRED,
  AutomationJobStatus.NEEDS_INPUT,
  AutomationJobStatus.READY,
  AutomationJobStatus.STALE,
  AutomationJobStatus.CLAIMED,
  AutomationJobStatus.IN_PROGRESS,
  AutomationJobStatus.NEEDS_REVIEW,
  AutomationJobStatus.AWAITING_PORTAL_REVIEW,
  AutomationJobStatus.FAILED_RETRYABLE,
  AutomationJobStatus.FAILED,
]);

const preparationHref = (applicationId: string, jobId: string) =>
  `/planning/${encodeURIComponent(applicationId)}/preparation?job=${encodeURIComponent(jobId)}`;

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'automation-jobs:restart');
  const { organisation, user } = await requireOrganisation(context);
  const oldJobId = context.params.id;
  if (!oldJobId) throw new HttpError(400, 'Automation job id is required.');

  const oldJob = await prisma.automationJob.findFirst({
    where: { id: oldJobId, organisationId: organisation.id },
    select: {
      id: true,
      organisationId: true,
      projectId: true,
      type: true,
      status: true,
      dataSnapshot: true,
    },
  });
  if (!oldJob) throw new HttpError(404, 'Automation job not found.');
  if (!planningTypes.has(oldJob.type)) {
    throw new HttpError(409, 'Only Planning desktop automation can be restarted here.');
  }

  let identity;
  try {
    identity = resolveAutomationJobIdentity(oldJob);
  } catch (error) {
    throw new HttpError(409, error instanceof Error ? error.message : 'This Planning job cannot be restarted safely.');
  }

  if (oldJob.status === AutomationJobStatus.CANCELLED) {
    const replacement = await findReusableAutomationJob({
      organisationId: organisation.id,
      projectId: oldJob.projectId,
      type: oldJob.type,
      applicationId: identity.applicationId,
    });
    if (replacement) {
      return jsonResponse(200, {
        job: replacement,
        preparationRedirectTo: preparationHref(identity.applicationId, replacement.id),
      });
    }
  }

  const newJobId = randomUUID();
  const snapshot = await buildAutomationJobSnapshot({
    jobId: newJobId,
    organisationId: organisation.id,
    organisationName: organisation.name,
    projectId: oldJob.projectId,
    type: oldJob.type,
    createdBy: { id: user.id, name: user.name, email: user.email },
    planningApplicationId: identity.applicationId,
  });
  const newStatus = snapshot.preflight.status === 'READY'
    ? AutomationJobStatus.PREFLIGHT_REQUIRED
    : AutomationJobStatus.NEEDS_INPUT;

  const newJob = await prisma.$transaction(async (transaction) => {
    if (cancellableStatuses.has(oldJob.status)) {
      const cancelled = await transaction.automationJob.updateMany({
        where: {
          id: oldJob.id,
          organisationId: organisation.id,
          status: oldJob.status,
        },
        data: {
          status: AutomationJobStatus.CANCELLED,
          handoffCodeHash: null,
          handoffExpiresAt: null,
        },
      });
      if (!cancelled.count) {
        throw new HttpError(409, 'This automation attempt changed while it was being restarted. Refresh and try again.');
      }
    } else if (
      oldJob.status !== AutomationJobStatus.COMPLETED
      && oldJob.status !== AutomationJobStatus.FAILED_FINAL
      && oldJob.status !== AutomationJobStatus.CANCELLED
    ) {
      throw new HttpError(409, 'This automation attempt cannot be restarted from its current state.');
    }

    return transaction.automationJob.create({
      data: {
        id: newJobId,
        organisationId: organisation.id,
        projectId: oldJob.projectId,
        type: oldJob.type,
        status: newStatus,
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
  });

  await persistApplicationPreparationDraft(newJob.id, organisation.id);

  return jsonResponse(201, {
    job: newJob,
    preparationRedirectTo: preparationHref(identity.applicationId, newJob.id),
  });
}, context);
