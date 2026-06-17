export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { submissionPackageSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'packages:create');
    const { user, organisation } = await requireOrganisation(context);
    const body = await parseBody(context.request, submissionPackageSchema);
    const project = await prisma.project.findFirst({ where: { id: body.projectId, organisationId: organisation.id }, select: { id: true } });
    if (!project) throw new HttpError(404, 'Project not found.');

    const documents = body.documentIds.length
      ? await prisma.projectDocument.findMany({
          where: { id: { in: body.documentIds }, organisationId: organisation.id, projectId: body.projectId },
          select: { id: true },
        })
      : [];

    if (documents.length !== body.documentIds.length) {
      throw new HttpError(400, 'One or more documents do not belong to this project.');
    }

    const submissionPackage = await prisma.submissionPackage.create({
      data: {
        organisationId: organisation.id,
        projectId: body.projectId,
        createdById: user.id,
        name: body.name,
        type: body.type,
        status: body.status,
        documents: {
          create: documents.map((document, index) => ({
            documentId: document.id,
            sortOrder: index,
          })),
        },
      },
      include: { documents: true },
    });

    return jsonResponse(201, { submissionPackage });
  }, context);