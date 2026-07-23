export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  const { organisation } = await requireOrganisation(context);
  const [emails, suggestions, projects] = await Promise.all([
    prisma.trackedEmail.findMany({
      where: {
        organisationId: organisation.id,
        OR: [
          { matchStatus: { in: ['UNMATCHED', 'AMBIGUOUS'] } },
          { processingStatus: 'NEEDS_REVIEW' },
          { attachments: { some: { importedDocumentId: null } } },
        ],
      },
      include: {
        project: { select: { id: true, name: true } },
        attachments: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            importedDocumentId: true,
          },
        },
        _count: { select: { suggestions: { where: { status: 'PENDING' } } } },
      },
      orderBy: { sentAt: 'desc' },
      take: 100,
    }),
    prisma.gmailUpdateSuggestion.findMany({
      where: { organisationId: organisation.id, status: 'PENDING' },
      include: {
        trackedEmail: { select: { subject: true, sender: true, sentAt: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    }),
    prisma.project.findMany({
      where: { organisationId: organisation.id, status: { not: 'ARCHIVED' } },
      select: { id: true, name: true, internalReference: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return jsonResponse(200, { emails, suggestions, projects });
}, context);
