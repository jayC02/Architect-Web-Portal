export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { desktopTokenCreateSchema } from '@/lib/validation/desktop-handoff';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { createDesktopTokenValue, desktopTokenExpiry, desktopTokenHash, desktopTokenPrefix } from '@/server/auth/desktop-token';

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  const { organisation, user } = await requireOrganisation(context);
  const tokens = await prisma.desktopAccessToken.findMany({
    where: { organisationId: organisation.id, userId: user.id, revokedAt: null },
    select: { id: true, name: true, tokenPrefix: true, expiresAt: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return jsonResponse(200, { tokens });
}, context);

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.auth, 'desktop-token:create');
  const { organisation, user } = await requireOrganisation(context);
  const body = await parseBody(context.request, desktopTokenCreateSchema);
  const token = createDesktopTokenValue();
  const record = await prisma.desktopAccessToken.create({
    data: {
      organisationId: organisation.id,
      userId: user.id,
      name: body.name,
      tokenHash: desktopTokenHash(token),
      tokenPrefix: desktopTokenPrefix(token),
      expiresAt: desktopTokenExpiry(),
    },
    select: { id: true, name: true, tokenPrefix: true, expiresAt: true, createdAt: true },
  });
  return jsonResponse(201, { token, record });
}, context);
