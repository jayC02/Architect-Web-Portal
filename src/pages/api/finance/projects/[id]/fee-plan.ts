export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { projectFeePlanSchema } from '@/lib/validation/fee-plans';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisationRole } from '@/server/permissions/authz';
import { assignProjectFeePlan } from '@/server/services/fee-plans.service';
import { makeFeeMilestonesEligible } from '@/server/services/xero-draft-invoices.service';

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  return jsonResponse(200, { feePlan: await prisma.projectFeePlan.findFirst({
    where: { projectId: context.params.id, organisationId: organisation.id },
    include: { milestones: { orderBy: { sortOrder: 'asc' } } },
  }) });
}, context);

export const PUT: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'finance:project-fee-plan');
  const { organisation, user } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const input = await parseBody(context.request, projectFeePlanSchema);
  const feePlan = await prisma.$transaction((tx) => assignProjectFeePlan(tx, organisation.id, context.params.id!, user.id, input));
  const priorEvents = await prisma.lifecycleEvent.findMany({
    where: { organisationId: organisation.id, projectId: context.params.id! },
    orderBy: { occurredAt: 'asc' },
  });
  for (const event of priorEvents) await makeFeeMilestonesEligible(prisma, event);
  return jsonResponse(200, { feePlan });
}, context);
