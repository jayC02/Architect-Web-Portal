export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { addCompletionDocument } from '@/server/services/completion-certificate.service';

/**
 * Add a completion document: a multipart upload with `file`, or JSON
 * `{ documentId }` for a document already in the project.
 */
export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.upload, 'completion:documents');
    const { organisation, user } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Building warrant application id is required.');
    const contentType = context.request.headers.get('content-type') ?? '';
    let file: File | undefined;
    let documentId: string | undefined;
    if (contentType.includes('multipart/form-data')) {
      const form = await context.request.formData();
      const value = form.get('file');
      if (!(value instanceof File)) throw new HttpError(400, 'Choose a file to upload.');
      file = value;
    } else {
      const body = await context.request.json().catch(() => null) as { documentId?: unknown } | null;
      if (typeof body?.documentId !== 'string' || !body.documentId.trim()) throw new HttpError(400, 'Choose a document to add.');
      documentId = body.documentId.trim().slice(0, 120);
    }
    const result = await addCompletionDocument({
      organisationId: organisation.id, warrantId: id, userId: user.id, file, documentId,
    });
    return jsonResponse(200, { ok: true, ...result });
  }, context);
