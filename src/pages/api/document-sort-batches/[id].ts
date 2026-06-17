export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Sort batch id is required.');

    const batch = await prisma.documentSortBatch.findFirst({
      where: { id, organisationId: organisation.id },
      include: {
        project: { select: { id: true, name: true } },
        items: {
          include: { document: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!batch) throw new HttpError(404, 'Document sort batch not found.');
    return jsonResponse(200, { batch });
  }, context);