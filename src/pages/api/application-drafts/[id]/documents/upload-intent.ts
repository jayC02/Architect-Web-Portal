export const prerender = false;

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { createApplicationDraftUploadIntent } from '@/server/services/application-draft-files.service';

const inputSchema = z.object({
  filename: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(160),
  size: z.number().int().positive(),
  clientSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
}).strict();

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.upload, 'application-drafts:upload-intent');
    const { organisation } = await requireOrganisation(context);
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
      upload: result.signedUpload ? { url: result.signedUpload.uploadUrl, token: result.signedUpload.token } : null,
      storage: result.storage,
    });
  }, context);
