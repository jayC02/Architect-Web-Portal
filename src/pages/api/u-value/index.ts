export const prerender = false;
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { saveUValueCalculation } from '@/server/services/u-value.service';

export const GET: APIRoute = context => withErrorHandling(async () => {
  const { organisation } = await requireOrganisation(context);
  const projectId = context.url.searchParams.get('projectId')?.slice(0, 120);
  const calculations = await prisma.uValueCalculation.findMany({
    where: { organisationId: organisation.id, ...(projectId ? { projectId } : {}) },
    select: { id: true, title: true, projectId: true, createdAt: true, methodVersion: true },
    orderBy: { createdAt: 'desc' }, take: 100,
  });
  return jsonResponse(200, { calculations });
}, context);
export const POST: APIRoute = context => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'u-value:save');
  const { organisation, user } = await requireOrganisation(context);
  const calculation = await saveUValueCalculation({ organisationId: organisation.id,
    organisationName: organisation.name, userId: user.id, userName: user.name,
    body: await context.request.json().catch(() => ({})),
  });
  return jsonResponse(201, { calculation, reportUrl: `/tools/u-value/reports/${calculation.id}` });
}, context);
