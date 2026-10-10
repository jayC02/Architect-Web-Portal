export const prerender = false;


import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import {
  analyseApplicationDraft,
  getApplicationDraftForOrganisation,
} from '@/server/services/application-draft.service';
import { applicationDraftResponse } from '@/server/services/application-draft-view.service';

const inputSchema = z.object({ force: z.boolean().default(false) }).strict();

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.upload, 'application-drafts:analyse');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Application draft id is required.');
    const input = await parseBody(context.request, inputSchema);
    await getApplicationDraftForOrganisation(id, organisation.id);
    await analyseApplicationDraft(id, organisation.id, input);
    const { startDocumentWorker } = await import('@/server/services/document-worker-start.service');
    startDocumentWorker(organisation.id);
    const draft = await getApplicationDraftForOrganisation(id, organisation.id);
    return jsonResponse(202, { draft: applicationDraftResponse(draft) });
  }, context);
