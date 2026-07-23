export const prerender = false;

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { applyGmailSuggestion, rejectGmailSuggestion } from '@/server/services/gmail-updates.service';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('apply'), value: z.unknown().optional() }),
  z.object({ action: z.literal('reject') }),
]);

export const PATCH: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'gmail:suggestion-review');
  const { organisation, user } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Suggestion id is required.');
  const body = await parseBody(context.request, schema);
  if (body.action === 'reject') {
    await rejectGmailSuggestion(organisation.id, id, user.id);
    return jsonResponse(200, { ok: true });
  }
  const result = await applyGmailSuggestion({
    organisationId: organisation.id,
    suggestionId: id,
    reviewedById: user.id,
    overrideValue: body.value,
  });
  return jsonResponse(200, { ok: true, ...result });
}, context);
