export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { applicationDraftUpdateSchema } from '@/lib/validation/application-draft';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { cancelApplicationDraft } from '@/server/services/application-draft-files.service';
import {
  getApplicationDraftForOrganisation,
  saveApplicationDraftReview,
} from '@/server/services/application-draft.service';
import { applicationDraftResponse } from '@/server/services/application-draft-view.service';

const draftIdFrom = (context: Parameters<APIRoute>[0]) => {
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Application draft id is required.');
  return id;
};

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const draft = await getApplicationDraftForOrganisation(draftIdFrom(context), organisation.id);
    return jsonResponse(200, { draft: applicationDraftResponse(draft) });
  }, context);

export const PATCH: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'application-drafts:update');
    const { organisation } = await requireOrganisation(context);
    const id = draftIdFrom(context);
    const input = await parseBody(context.request, applicationDraftUpdateSchema);
    const result = await saveApplicationDraftReview(id, organisation.id, input.review);
    const draft = await getApplicationDraftForOrganisation(id, organisation.id);
    return jsonResponse(200, {
      draft: applicationDraftResponse(draft),
      issues: result.issues,
    });
  }, context);

export const DELETE: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'application-drafts:cancel');
    const { organisation } = await requireOrganisation(context);
    await cancelApplicationDraft(draftIdFrom(context), organisation.id);
    return jsonResponse(200, { ok: true, redirectTo: '/applications/new' });
  }, context);
