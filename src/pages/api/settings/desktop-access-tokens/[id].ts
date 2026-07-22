export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const DELETE: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'desktop-token:revoke');
  const { organisation, user } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Desktop token id is required.');
  const result = await prisma.desktopAccessToken.updateMany({
    where: { id, organisationId: organisation.id, userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!result.count) throw new HttpError(404, 'Desktop connection not found.');
  return jsonResponse(200, { ok: true });
}, context);
