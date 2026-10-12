export const prerender = false;
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { getApplicationDraftForOrganisation } from '@/server/services/application-draft.service';
import { lookupSiteAddress } from '@/server/services/site-address-lookup.service';

const nullableText = (max: number) => z.string().trim().max(max).nullable();
const inputSchema = z.object({
  buildingNumber: nullableText(40), addressLine1: nullableText(200), addressLine2: nullableText(200),
  townCity: nullableText(120), postcode: nullableText(20), country: nullableText(80), localAuthority: nullableText(160),
}).strict();

export const POST: APIRoute = context => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'application-drafts:address-lookup');
  const { organisation } = await requireOrganisation(context);
  if (!context.params.id) throw new HttpError(400, 'Application draft id is required.');
  const draft = await getApplicationDraftForOrganisation(context.params.id, organisation.id);
  if (draft.expiresAt <= new Date() || ['COMMITTED', 'COMMITTING', 'CANCELLED', 'EXPIRED'].includes(draft.status)) {
    throw new HttpError(409, 'This application draft can no longer be edited.');
  }
  const input = await parseBody(context.request, inputSchema);
  return jsonResponse(200, await lookupSiteAddress(input));
}, context);
