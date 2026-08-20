export const prerender = false;

import { randomUUID } from 'node:crypto';
import {
  AutomationJobStatus,
  DeadlinePriority,
  DeadlineStatus,
  DeadlineType,
  Prisma,
} from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { desktopJobStatusSchema } from '@/lib/validation/desktop-handoff';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { assertDesktopJobAccess, requireDesktopAuth } from '@/server/auth/desktop-token';
import { assertAutomationJobTransition } from '@/server/services/automation-lifecycle.service';

const selectableStatuses = [
  AutomationJobStatus.READY,
  AutomationJobStatus.CLAIMED,
  AutomationJobStatus.IN_PROGRESS,
  AutomationJobStatus.NEEDS_REVIEW,
  AutomationJobStatus.AWAITING_PORTAL_REVIEW,
];

const serialiseJob = (job: any) => ({
  ...job,
  documents: Array.isArray(job.documentSnapshot?.documents)
    ? job.documentSnapshot.documents.map((document: any) => ({
        ...document,
        originalFilename: document.originalFilename ?? document.filename ?? document.originalName ?? document.fileName,
        originalName: document.originalFilename ?? document.filename ?? document.originalName ?? document.fileName,
        fileName: document.originalFilename ?? document.filename ?? document.originalName ?? document.fileName,
        type: document.categoryKey ?? document.type ?? 'OTHER',
        status: document.reviewState ?? document.status,
        downloadUrl: `/api/desktop/documents/${document.id}?jobId=${job.id}`,
      }))
    : [],
});

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-job:read');
  const access = await requireDesktopAuth(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Automation job id is required.');
  assertDesktopJobAccess(access, id);
  const job = await prisma.automationJob.findFirst({
    where: {
      id,
      organisationId: access.organisationId,
      status: { in: selectableStatuses },
      OR: [{ claimedDeviceId: null }, { claimedDeviceId: access.id }],
    },
    select: {
      id: true, projectId: true, type: true, status: true, sourceType: true, title: true,
      payloadVersion: true, dataSnapshot: true, documentSnapshot: true,
      claimedAt: true, createdAt: true, updatedAt: true,
    },
  });
  if (!job) throw new HttpError(404, 'Automation job not found or unavailable.');
  return jsonResponse(200, { job: serialiseJob(job) });
}, context);

export const PATCH: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-job:update');
  const access = await requireDesktopAuth(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Automation job id is required.');
  assertDesktopJobAccess(access, id);
  const body = await parseBody(context.request, desktopJobStatusSchema);
  if (body.jobId !== id) throw new HttpError(400, 'Desktop callback job id does not match the requested job.');
  const outcome = await prisma.$transaction(async (tx) => {
    const job = await tx.automationJob.findFirst({
      where: {
        id,
        organisationId: access.organisationId,
        claimedDeviceId: access.id,
      },
      select: { id: true, status: true, projectId: true },
    });
    if (!job) throw new HttpError(409, 'Automation job is not claimed by this desktop device.');

    const duplicate = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "AutomationJobEvent"
      WHERE "idempotencyKey" = ${body.callbackId}
      LIMIT 1
    `);
    if (duplicate.length) return { duplicate: true, status: job.status };

    assertAutomationJobTransition(job.status, body.status);
    const eventPayload = JSON.stringify({
      status: body.status,
      version: body.version,
      jobId: body.jobId,
      callbackId: body.callbackId,
      occurredAt: body.occurredAt,
      eventType: body.eventType,
      lastCheckpoint: body.lastCheckpoint ?? null,
      resultSummary: body.resultSummary ?? null,
      result: body.result ?? null,
    });
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "AutomationJobEvent"
        ("id", "organisationId", "automationJobId", "idempotencyKey", "eventType", "payload")
      VALUES
        (
          ${randomUUID()},
          ${access.organisationId},
          ${id},
          ${body.callbackId},
          ${body.eventType},
          CAST(${eventPayload} AS JSONB)
        )
    `);

    const update = await tx.automationJob.updateMany({
      where: {
        id,
        organisationId: access.organisationId,
        claimedDeviceId: access.id,
        status: job.status,
      },
      data: {
        status: body.status,
        resultSummary: body.resultSummary ?? undefined,
        resultData: body.result ? ({ ...body.result, occurredAt: body.occurredAt } as Prisma.InputJsonValue) : undefined,
        lastCheckpoint: body.lastCheckpoint ?? undefined,
        error: (
          body.status === AutomationJobStatus.FAILED_RETRYABLE
          || body.status === AutomationJobStatus.FAILED_FINAL
        ) ? (body.error || body.result?.errorSummary || 'Desktop automation stopped unexpectedly.') : null,
        completedAt: (
          body.status === AutomationJobStatus.COMPLETED
          || body.status === AutomationJobStatus.FAILED_RETRYABLE
          || body.status === AutomationJobStatus.FAILED_FINAL
        ) ? new Date() : null,
      },
    });
    if (!update.count) throw new HttpError(409, 'Automation job changed while the desktop result was being saved.');
    const retryDeadlineSource = `automation-job:${id}:retry`;
    if (body.status === AutomationJobStatus.FAILED_RETRYABLE) {
      await tx.deadline.upsert({
        where: {
          organisationId_sourceKey: {
            organisationId: access.organisationId,
            sourceKey: retryDeadlineSource,
          },
        },
        create: {
          organisationId: access.organisationId,
          projectId: job.projectId,
          title: 'Review desktop automation failure',
          description: body.result?.errorSummary || body.error || 'Review the desktop result and prepare a retry.',
          dueDate: new Date(),
          type: DeadlineType.INTERNAL_TASK,
          status: DeadlineStatus.DUE_SOON,
          priority: DeadlinePriority.HIGH,
          sourceKey: retryDeadlineSource,
        },
        update: {
          description: body.result?.errorSummary || body.error || 'Review the desktop result and prepare a retry.',
          dueDate: new Date(),
          status: DeadlineStatus.DUE_SOON,
          completedDate: null,
        },
      });
    } else if (
      body.status === AutomationJobStatus.AWAITING_PORTAL_REVIEW
      || body.status === AutomationJobStatus.COMPLETED
    ) {
      await tx.deadline.updateMany({
        where: {
          organisationId: access.organisationId,
          sourceKey: retryDeadlineSource,
          status: { notIn: [DeadlineStatus.COMPLETED, DeadlineStatus.CANCELLED] },
        },
        data: { status: DeadlineStatus.CANCELLED },
      });
    }
    return { duplicate: false, status: body.status };
  });
  return jsonResponse(200, { ok: true, ...outcome });
}, context);
