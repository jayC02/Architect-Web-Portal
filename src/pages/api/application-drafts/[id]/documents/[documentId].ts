export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { readStoredDocumentBytes } from '@/lib/server/upload-storage';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { removeApplicationDraftDocument } from '@/server/services/application-draft-files.service';

const safeFilename = (filename: string) => filename.replace(/[\r\n"\\]/g, '_');

const routeIds = (context: Parameters<APIRoute>[0]) => {
  const draftId = context.params.id;
  const documentId = context.params.documentId;
  if (!draftId || !documentId) throw new HttpError(400, 'Draft and document ids are required.');
  return { draftId, documentId };
};

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const { draftId, documentId } = routeIds(context);
    const document = await prisma.applicationDraftDocument.findFirst({
      where: {
        id: documentId,
        draftId,
        draft: { organisationId: organisation.id },
      },
      select: {
        storageKey: true,
        mimeType: true,
        originalFilename: true,
      },
    });
    if (!document) throw new HttpError(404, 'Draft document not found.');
    const bytes = await readStoredDocumentBytes(document.storageKey);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'content-type': document.mimeType || 'application/octet-stream',
        'content-disposition': `inline; filename="${safeFilename(document.originalFilename)}"`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=60',
      },
    });
  }, context);

export const DELETE: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'application-drafts:remove-document');
    const { organisation } = await requireOrganisation(context);
    const { draftId, documentId } = routeIds(context);
    await removeApplicationDraftDocument(draftId, documentId, organisation.id);
    return jsonResponse(200, { ok: true });
  }, context);
