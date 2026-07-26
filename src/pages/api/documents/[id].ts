export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { readStoredDocumentBytes } from '@/lib/server/upload-storage';
import { documentMetadataSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

const inlineFilename = (filename: string) => filename.replace(/[\r\n"\\]/g, '_');

const streamHeaders = (mimeType: string, originalName: string) => ({
  'content-type': mimeType || 'application/octet-stream',
  'content-disposition': `inline; filename="${inlineFilename(originalName)}"`,
  'x-content-type-options': 'nosniff',
  'cache-control': 'private, max-age=60',
});

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Document id is required.');

    const document = await prisma.projectDocument.findFirst({
      where: { id, organisationId: organisation.id },
      select: { storageKey: true, mimeType: true, originalName: true, storageUrl: true },
    });
    if (!document) throw new HttpError(404, 'Document not found.');

    const bytes = await readStoredDocumentBytes(document.storageKey, document.storageUrl);
    return new Response(new Uint8Array(bytes), { status: 200, headers: streamHeaders(document.mimeType, document.originalName) });
  }, context);

export const PATCH: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'documents:update');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Document id is required.');
    const body = await parseBody(context.request, documentMetadataSchema);
    const result = await prisma.projectDocument.updateMany({
      where: { id, organisationId: organisation.id },
      data: body,
    });
    if (!result.count) throw new HttpError(404, 'Document not found.');
    return jsonResponse(200, { ok: true });
  }, context);
export const DELETE: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'documents:delete');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Document id is required.');
    const result = await prisma.projectDocument.deleteMany({
      where: { id, organisationId: organisation.id },
    });
    if (!result.count) throw new HttpError(404, 'Document not found.');
    return jsonResponse(200, { ok: true });
  }, context);
