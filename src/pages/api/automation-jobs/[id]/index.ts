export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { automationJobStatusUpdateSchema } from '@/lib/validation/automation-job';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

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
    const result = await prisma.automationJob.updateMany({
      where: { id, organisationId: organisation.id },
      data: { status: body.status },
    });
    if (result.count === 0) throw new HttpError(404, 'Automation job not found.');
    return jsonResponse(200, { ok: true, redirectTo: '/automation-jobs' });
  }, context);
