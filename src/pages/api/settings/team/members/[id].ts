export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisationRole } from '@/server/permissions/authz';
import { removeTeamMember } from '@/server/billing/team';

export const DELETE: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'team:remove-member');
  const { organisation, user } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Member id is required.');
  await removeTeamMember({ organisationId: organisation.id, memberId: id, actorUserId: user.id });
  return jsonResponse(200, { ok: true });
}, context);
