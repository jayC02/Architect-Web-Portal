export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { withPerf } from '@/lib/utils/perf';
import { requireOrganisation, requireProjectAccess } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const projectId = context.params.id;
    if (!projectId) return jsonResponse(400, { error: 'Project id is required.' });
    await requireProjectAccess(organisation.id, projectId);

    const project = await withPerf('api.project.files', () =>
      prisma.project.findFirstOrThrow({
        where: { id: projectId, organisationId: organisation.id },
        select: {
          id: true,
          name: true,
          documents: {
            select: {
              id: true,
              storageUrl: true,
              originalName: true,
              type: true,
              revision: true,
              status: true,
              notes: true,
              drawingNumber: true,
              drawingTitle: true,
              sortConfidence: true,
              createdAt: true,
              sizeBytes: true,
              uploadedBy: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
          documentSortBatches: {
            select: { id: true, status: true, fileCount: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
          submissionPackages: {
            select: {
              id: true,
              name: true,
              type: true,
              status: true,
              documents: { select: { documentId: true } },
            },
            orderBy: { updatedAt: 'desc' },
          },
        },
      }),
    );

    return jsonResponse(200, { project });
  }, context);