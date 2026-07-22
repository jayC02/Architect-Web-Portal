export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { desktopJobStatusSchema } from '@/lib/validation/desktop-handoff';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireDesktopAuth } from '@/server/auth/desktop-token';

const selectableStatuses = [
  AutomationJobStatus.READY,
  AutomationJobStatus.CLAIMED,
  AutomationJobStatus.IN_PROGRESS,
  AutomationJobStatus.NEEDS_REVIEW,
];

const serialiseJob = (job: any) => ({
  ...job,
  documents: Array.isArray(job.documentSnapshot?.documents)
    ? job.documentSnapshot.documents.map((document: any) => ({
        ...document,
        downloadUrl: `/api/desktop/documents/${document.id}?jobId=${job.id}`,
      }))
    : [],
});

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-job:read');
  const access = await requireDesktopAuth(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Automation job id is required.');
  const job = await prisma.automationJob.findFirst({
    where: {
      id,
      organisationId: access.organisationId,
      status: { in: selectableStatuses },
      OR: [{ claimedDeviceId: null }, { claimedDeviceId: access.id }],
    },
    select: {
      id: true, type: true, status: true, sourceType: true, title: true,
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
  const body = await parseBody(context.request, desktopJobStatusSchema);
  const result = await prisma.automationJob.updateMany({
    where: {
      id,
      organisationId: access.organisationId,
      claimedDeviceId: access.id,
      status: { notIn: [AutomationJobStatus.COMPLETED, AutomationJobStatus.CANCELLED] },
    },
    data: {
      status: body.status,
      resultSummary: body.resultSummary ?? null,
      error: body.status === AutomationJobStatus.FAILED ? (body.error || 'Desktop automation stopped unexpectedly.') : null,
      completedAt: body.status === AutomationJobStatus.COMPLETED ? new Date() : null,
    },
  });
  if (!result.count) throw new HttpError(409, 'Automation job is not claimed by this desktop device.');
  return jsonResponse(200, { ok: true, status: body.status });
}, context);
