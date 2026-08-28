export const prerender = false;

import { AgentOperatingState } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const DELETE: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'desktop-agent:revoke');
  const { organisation, membership, user } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Agent id is required.');
  const canManageAll = membership.role === 'OWNER' || membership.role === 'ADMIN';
  const revoked = await prisma.agentRegistration.updateMany({
    where: {
      id,
      organisationId: organisation.id,
      enabled: true,
      revokedAt: null,
      ...(canManageAll ? {} : { enrolledByUserId: user.id }),
    },
    data: { enabled: false, revokedAt: new Date(), operatingState: AgentOperatingState.DISCONNECTED },
  });
  if (!revoked.count) throw new HttpError(404, 'Architect Pro Agent not found.');
  return jsonResponse(200, { ok: true });
}, context);
