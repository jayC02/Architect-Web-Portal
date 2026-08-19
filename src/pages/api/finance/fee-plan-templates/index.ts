export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { feePlanTemplateSchema } from '@/lib/validation/fee-plans';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisationRole } from '@/server/permissions/authz';
import { createFeePlanTemplate } from '@/server/services/fee-plans.service';

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  return jsonResponse(200, { templates: await prisma.feePlanTemplate.findMany({
    where: { organisationId: organisation.id, active: true },
    include: { milestones: { orderBy: { sortOrder: 'asc' } } },
    orderBy: [{ name: 'asc' }, { version: 'desc' }],
  }) });
}, context);

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'finance:fee-plan-template');
  const { organisation, user } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const input = await parseBody(context.request, feePlanTemplateSchema);
  return jsonResponse(201, { template: await createFeePlanTemplate(prisma, organisation.id, user.id, input) });
}, context);
