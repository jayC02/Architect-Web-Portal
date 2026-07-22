export const prerender = false;

import fs from 'node:fs/promises';
import path from 'node:path';
import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError } from '@/lib/utils/http';
import { requireDesktopAuth } from '@/server/auth/desktop-token';

const safeFilename = (value: string) => value.replace(/[\r\n"\\]/g, '_');
const safeStorageKey = (value: string | null) => {
  if (!value) throw new HttpError(404, 'Document file is not available.');
  const normalised = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalised || normalised.split('/').some((part) => part === '..') || path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new HttpError(400, 'Document storage key is invalid.');
  }
  return normalised;
};

const headers = (mimeType: string, originalName: string) => ({
  'content-type': mimeType || 'application/octet-stream',
  'content-disposition': `attachment; filename="${safeFilename(originalName)}"`,
  'x-content-type-options': 'nosniff',
  'cache-control': 'private, no-store, max-age=0',
});

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-document:download');
  const access = await requireDesktopAuth(context);
  const id = context.params.id;
  const jobId = context.url.searchParams.get('jobId');
  if (!id || !jobId) throw new HttpError(400, 'Document id and automation job id are required.');

  const job = await prisma.automationJob.findFirst({
    where: {
      id: jobId,
      organisationId: access.organisationId,
      claimedDeviceId: access.id,
      status: { in: [AutomationJobStatus.CLAIMED, AutomationJobStatus.IN_PROGRESS, AutomationJobStatus.NEEDS_REVIEW] },
    },
    select: { documentSnapshot: true },
  });
  if (!job) throw new HttpError(404, 'Claimed automation job not found.');
  const snapshot = job.documentSnapshot as { documents?: Array<{ id?: string }> } | null;
  if (!snapshot?.documents?.some((document) => document.id === id)) {
    throw new HttpError(404, 'Document is not part of this automation job.');
  }

  const document = await prisma.projectDocument.findFirst({
    where: { id, organisationId: access.organisationId },
    select: { storageKey: true, mimeType: true, originalName: true },
  });
  if (!document) throw new HttpError(404, 'Document not found.');
  const storageKey = safeStorageKey(document.storageKey);
  const provider = process.env.UPLOAD_STORAGE_PROVIDER ?? 'local';

  if (provider === 'supabase') {
    const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET;
    if (!supabaseUrl || !serviceKey || !bucket) throw new HttpError(500, 'Document storage is not configured.');
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${storageKey}`, {
      headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    });
    if (!response.ok || !response.body) throw new HttpError(404, 'Document file could not be downloaded.');
    return new Response(response.body, { status: 200, headers: headers(document.mimeType, document.originalName) });
  }

  if (provider === 'local') {
    const configured = process.env.UPLOAD_STORAGE_DIR ?? 'public/uploads';
    const root = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
    const filePath = path.resolve(root, storageKey);
    if (!filePath.startsWith(path.resolve(root) + path.sep)) throw new HttpError(400, 'Document path is invalid.');
    const bytes = await fs.readFile(filePath).catch(() => null);
    if (!bytes) throw new HttpError(404, 'Document file could not be downloaded.');
    return new Response(bytes, { status: 200, headers: headers(document.mimeType, document.originalName) });
  }

  throw new HttpError(500, 'Unsupported document storage provider.');
}, context);
