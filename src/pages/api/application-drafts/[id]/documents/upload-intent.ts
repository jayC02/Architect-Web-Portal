export const prerender = false;

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertAuthenticatedUploadLimit } from '@/server/services/upload-limits.service';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { createApplicationDraftUploadIntent } from '@/server/services/application-draft-files.service';
import { getApplicationDraftForOrganisation } from '@/server/services/application-draft.service';

const inputSchema = z.object({
  filename: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(160),
  size: z.number().int().positive(),
  clientSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  clientUploadId: z.string().uuid().optional(),
}).strict();
export const GET: APIRoute = context => withErrorHandling(async () => {
  const { organisation } = await requireOrganisation(context);
  if (!context.params.id) throw new HttpError(400, 'Draft id is required.');
  const draft = await getApplicationDraftForOrganisation(context.params.id, organisation.id);
  return jsonResponse(200, { documents: draft.documents.filter(document => document.uploadStatus !== 'READY').map(document => ({ id: document.id, originalFilename: document.originalFilename, sizeBytes: document.sizeBytes, status: document.uploadStatus })) });
}, context);

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    const { organisation, user } = await requireOrganisation(context);
    await assertAuthenticatedUploadLimit(context, organisation.id, user.id);
    const draftId = context.params.id;
    if (!draftId) throw new HttpError(400, 'Application draft id is required.');
    const input = await parseBody(context.request, inputSchema);
    const result = await createApplicationDraftUploadIntent(draftId, organisation.id, input);
    return jsonResponse(201, {
      document: {
        id: result.document.id,
        originalFilename: result.document.originalFilename,
        sizeBytes: result.document.sizeBytes,
        uploadStatus: result.document.uploadStatus,
      },
      upload: result.signedUpload ? { ...result.signedUpload, url: result.signedUpload.uploadUrl } : null,
      storage: result.storage,
    });
  }, context);
