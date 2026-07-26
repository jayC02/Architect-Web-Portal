export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { readStoredDocumentBytes } from '@/lib/server/upload-storage';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError } from '@/lib/utils/http';
import { assertDesktopJobAccess, requireDesktopAuth } from '@/server/auth/desktop-token';

const safeFilename = (value: string) => value.replace(/[\r\n"\\]/g, '_');
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
  assertDesktopJobAccess(access, jobId);

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
    select: { storageKey: true, storageUrl: true, mimeType: true, originalName: true },
  });
  if (!document) throw new HttpError(404, 'Document not found.');
  const bytes = await readStoredDocumentBytes(document.storageKey, document.storageUrl);
  return new Response(new Uint8Array(bytes), { status: 200, headers: headers(document.mimeType, document.originalName) });
}, context);
