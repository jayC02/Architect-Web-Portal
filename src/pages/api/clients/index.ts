export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { clientSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { withPerf } from '@/lib/utils/perf';
import { requireOrganisation } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const clients = await withPerf('api.clients.list', () =>
      prisma.client.findMany({
        where: { organisationId: organisation.id },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          address: true,
          notes: true,
          title: true,
          firstName: true,
          lastName: true,
          companyName: true,
          addressLine1: true,
          addressLine2: true,
          townCity: true,
          postcode: true,
          country: true,
          _count: { select: { projects: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
    );
    return jsonResponse(200, { clients });
  }, context);

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'clients:create');
    const { organisation } = await requireOrganisation(context);
    const body = await parseBody(context.request, clientSchema);
    const client = await prisma.client.create({
      data: { ...body, organisationId: organisation.id },
    });
    return jsonResponse(201, { client });
  }, context);
