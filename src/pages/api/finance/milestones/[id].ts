import { databaseTable } from '@/lib/db/table';
export const prerender = false;

import { ActionItemStatus, ProjectFeeMilestoneState, Prisma } from '@prisma/client';
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
  const { organisation, user } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const input = await parseBody(context.request, projectFeeMilestoneUpdateSchema);
  const updated = await prisma.$transaction(async (tx) => {
  const original = await tx.projectFeeMilestone.findFirst({
    where: { id: context.params.id, organisationId: organisation.id }, include: { projectFeePlan: true },
  });
  if (!original) throw new HttpError(404, 'Fee milestone not found.');
  await tx.$queryRaw`SELECT id FROM ${databaseTable('Project')} WHERE id = ${original.projectFeePlan.projectId} AND "organisationId" = ${organisation.id} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM ${databaseTable('ProjectFeeMilestone')} WHERE id = ${original.id} FOR UPDATE`;
  const before = await tx.projectFeePlan.findUniqueOrThrow({ where: { id: original.projectFeePlanId }, include: { milestones: true } });
  if (input.revision !== undefined && input.revision !== before.revision) throw new HttpError(409, 'The billing schedule changed. Reload before saving; your values are kept.');
  const milestone = await tx.projectFeeMilestone.findFirst({
    where: { id: context.params.id, organisationId: organisation.id },
    include: { writeAttempt: { select: { id: true } } },
  });
  if (!milestone) throw new HttpError(404, 'Fee milestone not found.');
  const editableStates = new Set<ProjectFeeMilestoneState>([ProjectFeeMilestoneState.PENDING, ProjectFeeMilestoneState.ELIGIBLE]);
  if (milestone.writeAttempt || !editableStates.has(milestone.state)) {
    throw new HttpError(409, 'This milestone can no longer be edited because accounting work has begun.');
  }
  const updated = await tx.projectFeeMilestone.update({
    where: { id: milestone.id },
    data: {
      ...(input.amount ? { amount: input.amount, scheduleBasis: 'FIXED', percentage: null } : {}),
      ...(input.invoiceDescription ? { invoiceDescription: input.invoiceDescription } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.waive ? { state: ProjectFeeMilestoneState.WAIVED, enabled: false, lastError: null } : {}),
    },
  });
  if (input.waive) {
    await tx.actionItem.updateMany({
      where: { organisationId: organisation.id, dedupeKey: `xero:milestone:${milestone.id}:draft`, status: ActionItemStatus.OPEN },
      data: { status: ActionItemStatus.RESOLVED, resolvedAt: new Date() },
    });
  }
  const after = await tx.projectFeePlan.update({ where: { id: before.id }, data: { revision: { increment: 1 } }, include: { milestones: true } });
  const snapshot = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  await tx.projectFeeRevision.create({ data: { projectFeePlanId: before.id, revision: after.revision, changedByUserId: user.id, before: snapshot(before), after: snapshot(after) } });
  return updated;
  });
  return jsonResponse(200, { milestone: updated });
}, context);
