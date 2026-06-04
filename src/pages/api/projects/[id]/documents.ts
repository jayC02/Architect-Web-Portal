export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { saveUploadedDocument } from '@/lib/server/uploads';
import { documentMetadataSchema } from '@/lib/validation/domain';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation, requireProjectAccess } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const projectId = context.params.id;
    if (!projectId) throw new HttpError(400, 'Project id is required.');
    await requireProjectAccess(organisation.id, projectId);
    const documents = await prisma.projectDocument.findMany({
      where: { organisationId: organisation.id, projectId },
      include: { uploadedBy: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return jsonResponse(200, { documents });
  });

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.upload, 'documents:upload');
    const { user, organisation } = await requireOrganisation(context);
    const projectId = context.params.id;
    if (!projectId) throw new HttpError(400, 'Project id is required.');
    await requireProjectAccess(organisation.id, projectId);

    const form = await context.request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'Document file is required.');
    const metadata = documentMetadataSchema.parse(Object.fromEntries(form.entries()));
    const saved = await saveUploadedDocument(file, {
      folder: `organisations/${organisation.id}/projects/${projectId}`,
      label: 'document',
    });

    const document = await prisma.projectDocument.create({
      data: {
        organisationId: organisation.id,
        projectId,
        uploadedById: user.id,
        originalName: file.name || saved.fileName,
        ...saved,
        ...metadata,
      },
    });

    return jsonResponse(201, { document });
  });
