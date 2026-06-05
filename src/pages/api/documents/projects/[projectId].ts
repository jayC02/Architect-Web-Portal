export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { documentGroupType, documentTypeLabel, preferredDocumentTypes } from '@/lib/document-categories';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { withPerf } from '@/lib/utils/perf';
import { requireOrganisation, requireProjectAccess } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const projectId = context.params.projectId;
    if (!projectId) throw new HttpError(400, 'Project id is required.');
    await requireProjectAccess(organisation.id, projectId);

    const project = await withPerf('api.documents.projectFolder', () =>
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
              createdAt: true,
              sizeBytes: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
    );

    const buckets = preferredDocumentTypes.map((type) => ({
      type,
      label: documentTypeLabel(type),
      documents: project.documents.filter((document) => documentGroupType(document.type) === type),
    }));

    return jsonResponse(200, {
      project: { id: project.id, name: project.name, documentCount: project.documents.length },
      buckets,
    });
  });
