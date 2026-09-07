export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { revokeAgentInTransaction } from '@/server/services/desktop-agent-revocation.service';

export const DELETE: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'desktop-agent:revoke');
  const { organisation, membership, user } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Agent id is required.');
  const canManageAll = membership.role === 'OWNER' || membership.role === 'ADMIN';
  await prisma.$transaction((tx) => revokeAgentInTransaction(tx, {
    agentId: id, organisationId: organisation.id,
    ...(canManageAll ? {} : { enrolledByUserId: user.id }),
  }));
  return jsonResponse(200, { ok: true });
}, context);
