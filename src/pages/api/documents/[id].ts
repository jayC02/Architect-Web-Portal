export const prerender = false;

import fs from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { documentMetadataSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

const inlineFilename = (filename: string) => filename.replace(/[\r\n"\\]/g, '_');

const assertSafeStorageKey = (storageKey: string | null | undefined) => {
  if (!storageKey) throw new HttpError(404, 'Document file is not available.');
  const normalised = storageKey.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalised || normalised.split('/').some((segment) => segment === '..') || path.isAbsolute(storageKey) || path.win32.isAbsolute(storageKey)) {
    throw new HttpError(400, 'Document storage key is invalid.');
  }
  return normalised;
};

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

    const storageKey = assertSafeStorageKey(document.storageKey);
    const provider = process.env.UPLOAD_STORAGE_PROVIDER ?? 'local';

    if (provider === 'supabase') {
      const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
      const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET;
      if (!supabaseUrl || !supabaseServiceRoleKey || !supabaseBucket) {
        throw new HttpError(500, 'Supabase storage is not configured.');
      }
      const response = await fetch(`${supabaseUrl}/storage/v1/object/${supabaseBucket}/${storageKey}`, {
        headers: {
          authorization: `Bearer ${supabaseServiceRoleKey}`,
          apikey: supabaseServiceRoleKey,
        },
      });
      if (!response.ok || !response.body) throw new HttpError(404, 'Document file could not be opened.');
      return new Response(response.body, { status: 200, headers: streamHeaders(document.mimeType, document.originalName) });
    }

    if (provider === 'local') {
      const configuredLocalDir = process.env.UPLOAD_STORAGE_DIR ?? 'public/uploads';
      const storageRoot = path.isAbsolute(configuredLocalDir) ? configuredLocalDir : path.resolve(process.cwd(), configuredLocalDir);
      const filePath = path.resolve(storageRoot, storageKey);
      if (!filePath.startsWith(path.resolve(storageRoot) + path.sep)) throw new HttpError(400, 'Document path is invalid.');
      const bytes = await fs.readFile(filePath).catch(() => null);
      if (!bytes) throw new HttpError(404, 'Document file could not be opened.');
      return new Response(bytes, { status: 200, headers: streamHeaders(document.mimeType, document.originalName) });
    }

    if (document.storageUrl) return context.redirect(document.storageUrl);
    throw new HttpError(500, `Unsupported upload storage provider: ${provider}.`);
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