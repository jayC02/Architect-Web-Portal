export const prerender = false;

import { DocumentType } from '@prisma/client';
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { documentGroupType } from '@/lib/document-categories';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { withPerf } from '@/lib/utils/perf';
import { requireOrganisation } from '@/server/permissions/authz';

const documentsListQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  sort: z.enum(['recent', 'oldest', 'name', 'project']).optional().default('recent'),
  type: z.nativeEnum(DocumentType).optional(),
});

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const query = documentsListQuerySchema.parse(Object.fromEntries(context.url.searchParams.entries()));

    const documents = await withPerf('api.documents.list', () =>
      prisma.projectDocument.findMany({
        where: {
          organisationId: organisation.id,
          ...(query.type ? { type: query.type } : {}),
          ...(query.q
            ? {
                OR: [
                  { originalName: { contains: query.q, mode: 'insensitive' } },
                  { drawingTitle: { contains: query.q, mode: 'insensitive' } },
                  { drawingNumber: { contains: query.q, mode: 'insensitive' } },
                  { project: { name: { contains: query.q, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          projectId: true,
          originalName: true,
          type: true,
          revision: true,
          status: true,
          sizeBytes: true,
          createdAt: true,
          project: { select: { id: true, name: true, internalReference: true } },
          uploadedBy: { select: { name: true } },
        },
        orderBy:
          query.sort === 'oldest'
            ? { createdAt: 'asc' }
            : query.sort === 'name'
              ? { originalName: 'asc' }
              : query.sort === 'project'
                ? [{ project: { name: 'asc' } }, { createdAt: 'desc' }]
                : { createdAt: 'desc' },
        take: 100,
      }),
    );

    return jsonResponse(200, {
      documents: documents.map((document) => ({ ...document, type: documentGroupType(document.type) })),
      count: documents.length,
      limit: 100,
    });
  });
