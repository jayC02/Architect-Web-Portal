export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { siteSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { withPerf } from '@/lib/utils/perf';
import { requireOrganisation } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const sites = await withPerf('api.sites.list', () =>
      prisma.site.findMany({
        where: { organisationId: organisation.id },
        select: {
          id: true,
          buildingNumber: true,
          addressLine1: true,
          addressLine2: true,
          townCity: true,
          postcode: true,
          localAuthority: true,
          notes: true,
          _count: { select: { projects: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
    );
    return jsonResponse(200, { sites });
  }, context);

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'sites:create');
    const { organisation } = await requireOrganisation(context);
    const body = await parseBody(context.request, siteSchema);
    const site = await prisma.site.create({
      data: { ...body, organisationId: organisation.id },
    });
    return jsonResponse(201, { site });
  }, context);
