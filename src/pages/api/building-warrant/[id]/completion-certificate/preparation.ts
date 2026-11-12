export const prerender = false;

import type { APIRoute } from 'astro';
import { COMPLETION_FIXED_ANSWERS } from '@/lib/completion-certificate';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import {
  completionPreparationFor,
  loadCompletionContext,
  saveCompletionPreparation,
} from '@/server/services/completion-certificate.service';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Building warrant application id is required.');
    const completion = await loadCompletionContext({ organisationId: organisation.id, warrantId: id });
    return jsonResponse(200, {
      ...completionPreparationFor(completion),
      fixedAnswers: COMPLETION_FIXED_ANSWERS,
      documents: completion.documents,
    });
  }, context);

export const PATCH: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'completion:preparation');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Building warrant application id is required.');
    const body = await context.request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'Completion certificate details are required.');
    }
    const saved = await saveCompletionPreparation({ organisationId: organisation.id, warrantId: id, body });
    return jsonResponse(200, { ok: true, preparation: saved.preparation, issues: saved.issues });
  }, context);
