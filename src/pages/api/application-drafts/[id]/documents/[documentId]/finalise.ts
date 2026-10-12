export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { finaliseApplicationDraftDocument } from '@/server/services/application-draft-files.service';

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.upload, 'application-drafts:finalise-document');
    const { organisation } = await requireOrganisation(context);
    const draftId = context.params.id;
    const documentId = context.params.documentId;
    if (!draftId || !documentId) throw new HttpError(400, 'Draft and document ids are required.');
    const document = await finaliseApplicationDraftDocument(draftId, documentId, organisation.id);
    return jsonResponse(200, {
      document: {
        id: document.id,
        originalFilename: document.originalFilename,
        sizeBytes: document.sizeBytes,
        uploadStatus: document.uploadStatus,
      },
    });
  }, context);
