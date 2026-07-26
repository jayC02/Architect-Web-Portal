export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { automationJobStatusUpdateSchema } from '@/lib/validation/automation-job';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { automationJobSnapshotV2Schema } from '@/lib/validation/automation-job';
import { currentAutomationSourceUpdatedAt } from '@/server/services/automation-jobs.service';
import { assertAutomationJobTransition } from '@/server/services/automation-lifecycle.service';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Automation job id is required.');
    const { organisation } = await requireOrganisation(context);
    const job = await prisma.automationJob.findFirst({
      where: { id, organisationId: organisation.id },
      include: {
        project: { select: { id: true, name: true, internalReference: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        claimedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!job) throw new HttpError(404, 'Automation job not found.');
    return jsonResponse(200, { job });
  }, context);

export const PATCH: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'automation-jobs:update');
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Automation job id is required.');
    const { organisation } = await requireOrganisation(context);
    const body = await parseBody(context.request, automationJobStatusUpdateSchema);
    const job = await prisma.automationJob.findFirst({
      where: { id, organisationId: organisation.id },
      select: {
        id: true,
        projectId: true,
        status: true,
        payloadVersion: true,
        sourceUpdatedAt: true,
        dataSnapshot: true,
      },
    });
    if (!job) throw new HttpError(404, 'Automation job not found.');
    assertAutomationJobTransition(job.status, body.status);

    if (body.status === AutomationJobStatus.READY && job.payloadVersion >= 2) {
      const snapshot = automationJobSnapshotV2Schema.safeParse(job.dataSnapshot);
      if (!snapshot.success) throw new HttpError(409, 'This prepared application is not compatible with snapshot v2.');
      if (snapshot.data.preflight.status !== 'READY') {
        throw new HttpError(409, 'Resolve the missing application details before marking this job ready.', {
          preflight: snapshot.data.preflight,
        });
      }
      const currentSource = await currentAutomationSourceUpdatedAt(
        organisation.id,
        job.projectId,
        job.dataSnapshot,
      );
      if (!currentSource || !job.sourceUpdatedAt || currentSource > job.sourceUpdatedAt) {
        await prisma.automationJob.update({
          where: { id: job.id },
          data: { status: AutomationJobStatus.STALE },
        });
        throw new HttpError(409, 'Project information changed after this application was prepared. Refresh the prepared job before continuing.');
      }
    }
    const result = await prisma.automationJob.updateMany({
      where: { id, organisationId: organisation.id },
      data: {
        status: body.status,
        reviewedAt: body.status === AutomationJobStatus.READY ? new Date() : undefined,
        completedAt: body.status === AutomationJobStatus.COMPLETED ? new Date() : undefined,
      },
    });
    if (result.count === 0) throw new HttpError(404, 'Automation job not found.');
    return jsonResponse(200, { ok: true, redirectTo: '/automation-jobs' });
  }, context);
