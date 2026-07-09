export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Automation job id is required.');
    const { organisation } = await requireOrganisation(context);
    const job = await prisma.automationJob.findFirst({
      where: {
        id,
        organisationId: organisation.id,
        status: { in: [AutomationJobStatus.READY, AutomationJobStatus.CLAIMED, AutomationJobStatus.IN_PROGRESS] },
      },
      select: {
        id: true,
        type: true,
        status: true,
        sourceType: true,
        title: true,
        dataSnapshot: true,
        documentSnapshot: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!job) throw new HttpError(404, 'Ready automation job not found.');
    return jsonResponse(200, { job });
  }, context);
