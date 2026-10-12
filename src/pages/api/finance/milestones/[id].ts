export const prerender = false;

import { ActionItemStatus, ProjectFeeMilestoneState } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { projectFeeMilestoneUpdateSchema } from '@/lib/validation/fee-plans';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisationRole } from '@/server/permissions/authz';

export const PATCH: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'finance:update-fee-milestone');
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const input = await parseBody(context.request, projectFeeMilestoneUpdateSchema);
  const milestone = await prisma.projectFeeMilestone.findFirst({
    where: { id: context.params.id, organisationId: organisation.id },
    include: { writeAttempt: { select: { id: true } } },
  });
  if (!milestone) throw new HttpError(404, 'Fee milestone not found.');
  const editableStates = new Set<ProjectFeeMilestoneState>([ProjectFeeMilestoneState.PENDING, ProjectFeeMilestoneState.ELIGIBLE]);
  if (milestone.writeAttempt || !editableStates.has(milestone.state)) {
    throw new HttpError(409, 'This milestone can no longer be edited because accounting work has begun.');
  }
  const updated = await prisma.projectFeeMilestone.update({
    where: { id: milestone.id },
    data: {
      ...(input.amount ? { amount: input.amount } : {}),
      ...(input.invoiceDescription ? { invoiceDescription: input.invoiceDescription } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.waive ? { state: ProjectFeeMilestoneState.WAIVED, enabled: false, lastError: null } : {}),
    },
  });
  if (input.waive) {
    await prisma.actionItem.updateMany({
      where: { organisationId: organisation.id, dedupeKey: `xero:milestone:${milestone.id}:draft`, status: ActionItemStatus.OPEN },
      data: { status: ActionItemStatus.RESOLVED, resolvedAt: new Date() },
    });
  }
  return jsonResponse(200, { milestone: updated });
}, context);
