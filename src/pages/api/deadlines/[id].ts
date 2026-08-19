export const prerender = false;

import { LifecycleActorType, ProjectActivityEventType, ProjectActivityVisibility } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { removeDeadlineFromGoogleBestEffort, syncDeadlineToGoogleBestEffort } from '@/lib/integrations/google-calendar';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { deadlineSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { applyManualWorkflowDeadlineOverride } from '@/server/services/workflow-deadlines.service';

const assertScopedOptional = async (organisationId: string, model: 'project' | 'planning' | 'warrant', id?: string) => {
  if (!id) return null;
  const record =
    model === 'project'
      ? await prisma.project.findFirst({ where: { id, organisationId }, select: { id: true } })
      : model === 'planning'
        ? await prisma.planningApplication.findFirst({ where: { id, organisationId }, select: { id: true } })
        : await prisma.buildingWarrantApplication.findFirst({ where: { id, organisationId }, select: { id: true } });
  if (!record) throw new HttpError(400, `${model} link does not belong to this organisation.`);
  return id;
};

export const PATCH: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'deadlines:update');
    const { organisation, user } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Deadline id is required.');
    const body = await parseBody(context.request, deadlineSchema);
    const projectId = await assertScopedOptional(organisation.id, 'project', body.projectId);
    const planningApplicationId = await assertScopedOptional(organisation.id, 'planning', body.planningApplicationId);
    const buildingWarrantApplicationId = await assertScopedOptional(organisation.id, 'warrant', body.buildingWarrantApplicationId);
    const result = await prisma.$transaction(async (tx) => {
      const updated = await applyManualWorkflowDeadlineOverride(tx, {
        organisationId: organisation.id,
        deadlineId: id,
        dueDate: body.dueDate,
        actorUserId: user.id,
        updatedData: { ...body, projectId, planningApplicationId, buildingWarrantApplicationId },
      });
      if (updated?.overridden && updated.deadline.projectId && updated.manualOverrideAt) {
        const idempotencyKey = `deadline:${updated.deadline.id}:override:${updated.manualOverrideAt.toISOString()}`;
        await tx.projectActivity.create({
          data: {
            organisationId: organisation.id,
            projectId: updated.deadline.projectId,
            eventType: ProjectActivityEventType.WORKFLOW_DEADLINE_OVERRIDDEN,
            summary: `Workflow reminder date manually overridden: ${updated.deadline.title}`,
            actorType: LifecycleActorType.USER,
            actorUserId: user.id,
            sourceType: 'DEADLINE',
            sourceId: updated.deadline.id,
            visibility: ProjectActivityVisibility.STANDARD,
            occurredAt: updated.manualOverrideAt,
            idempotencyKey,
          },
        });
      }
      return updated;
    });
    if (!result) throw new HttpError(404, 'Deadline not found.');
    const calendarSync = await syncDeadlineToGoogleBestEffort(organisation.id, id);
    return jsonResponse(200, {
      ok: true,
      message: result.overridden ? 'Workflow reminder override saved.' : 'Deadline saved.',
      calendarSync,
    });
  }, context);

export const DELETE: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'deadlines:delete');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Deadline id is required.');
    const existing = await prisma.deadline.findFirst({ where: { id, organisationId: organisation.id }, select: { id: true } });
    if (!existing) throw new HttpError(404, 'Deadline not found.');
    const calendarSync = await removeDeadlineFromGoogleBestEffort(organisation.id, id);
    const result = await prisma.deadline.deleteMany({ where: { id, organisationId: organisation.id } });
    if (!result.count) throw new HttpError(404, 'Deadline not found.');
    return jsonResponse(200, { ok: true, calendarSync });
  }, context);
