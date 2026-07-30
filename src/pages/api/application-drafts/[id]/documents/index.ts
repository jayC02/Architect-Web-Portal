export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { addApplicationDraftDocuments } from '@/server/services/application-draft-files.service';
import { getApplicationDraftForOrganisation } from '@/server/services/application-draft.service';
import { applicationDraftResponse } from '@/server/services/application-draft-view.service';

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.upload, 'application-drafts:add-documents');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Application draft id is required.');
    const form = await context.request.formData();
    const files = form.getAll('files').filter(
      (entry): entry is File => entry instanceof File && entry.size > 0,
    );
    await addApplicationDraftDocuments(id, organisation.id, files);
    const draft = await getApplicationDraftForOrganisation(id, organisation.id);
    return jsonResponse(201, { draft: applicationDraftResponse(draft) });
  }, context);
