export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { planningApplicationCreateSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { withPerf } from '@/lib/utils/perf';
import { requireOrganisation, requireProjectAccess } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const projectId = context.params.id;
    if (!projectId) throw new HttpError(400, 'Project id is required.');
    await requireProjectAccess(organisation.id, projectId);
    const applications = await withPerf('api.project.planning', () =>
      prisma.planningApplication.findMany({
        where: { organisationId: organisation.id, projectId },
        orderBy: { updatedAt: 'desc' },
      }),
    );
    return jsonResponse(200, { applications });
  }, context);

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'planning:create');
    const { organisation } = await requireOrganisation(context);
    const projectId = context.params.id;
    if (!projectId) throw new HttpError(400, 'Project id is required.');
    await requireProjectAccess(organisation.id, projectId);
    const body = await parseBody(context.request, planningApplicationCreateSchema);
    const application = await prisma.planningApplication.create({
      data: { ...body, organisationId: organisation.id, projectId },
    });
    return jsonResponse(201, { application });
  }, context);
