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

    const project = await withPerf('api.project.overview', () =>
      prisma.project.findFirst({
        where: { id: projectId, organisationId: organisation.id },
        select: {
          id: true,
          name: true,
          stage: true,
          status: true,
          siteAddress: true,
          localAuthority: true,
          updatedAt: true,
          client: { select: { name: true, email: true } },
          site: { select: { addressLine1: true, postcode: true } },
          documents: {
            select: { id: true, originalName: true, type: true, revision: true },
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
          deadlines: {
            select: { id: true, title: true, type: true, priority: true, dueDate: true },
            orderBy: { dueDate: 'asc' },
            take: 5,
          },
        },
      }),
    );

    if (!project) return jsonResponse(200, { project: null });

    return jsonResponse(200, { project });
  }, context);