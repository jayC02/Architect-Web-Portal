export const prerender = false;

import { DocumentType, ProjectStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { documentGroupType } from '@/lib/document-categories';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { withPerf } from '@/lib/utils/perf';
import { requireOrganisation } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const activeProjectWhere = { organisationId: organisation.id, status: { notIn: [ProjectStatus.COMPLETED, ProjectStatus.ARCHIVED] } };

    const [projects, totalDocumentCount, recentDocuments, missingLocationProjects] = await withPerf('api.documents.hub', () =>
      Promise.all([
        prisma.project.findMany({
          where: { organisationId: organisation.id },
          select: {
            id: true,
            name: true,
            internalReference: true,
            siteAddress: true,
            status: true,
            client: { select: { name: true } },
            site: { select: { addressLine1: true, postcode: true } },
            documents: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
            _count: { select: { documents: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        }),
        prisma.projectDocument.count({ where: { organisationId: organisation.id } }),
        prisma.projectDocument.findMany({
          where: { organisationId: organisation.id },
          select: {
            id: true,
            projectId: true,
            originalName: true,
            type: true,
            createdAt: true,
            project: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 12,
        }),
        prisma.project.findMany({
          where: { ...activeProjectWhere, documents: { none: { type: DocumentType.LOCATION_PLAN } } },
          select: { id: true },
        }),
      ]),
    );

    const missingIds = new Set(missingLocationProjects.map((project) => project.id));
    return jsonResponse(200, {
      totalDocumentCount,
      missingLocationCount: missingLocationProjects.length,
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        internalReference: project.internalReference,
        summary: [project.client?.name, project.site ? [project.site.addressLine1, project.site.postcode].filter(Boolean).join(', ') : project.siteAddress].filter(Boolean).join(' - ') || 'No client or site linked yet',
        documentCount: project._count.documents,
        latestUpload: project.documents[0]?.createdAt ?? null,
        missingLocationPlan: project.status !== 'COMPLETED' && project.status !== 'ARCHIVED' && missingIds.has(project.id),
      })),
      recentDocuments: recentDocuments.map((document) => ({ ...document, type: documentGroupType(document.type) })),
    });
  }, context);