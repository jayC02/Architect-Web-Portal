export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { deadlineSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

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
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Deadline id is required.');
    const body = await parseBody(context.request, deadlineSchema);
    const projectId = await assertScopedOptional(organisation.id, 'project', body.projectId);
    const planningApplicationId = await assertScopedOptional(organisation.id, 'planning', body.planningApplicationId);
    const buildingWarrantApplicationId = await assertScopedOptional(organisation.id, 'warrant', body.buildingWarrantApplicationId);
    const result = await prisma.deadline.updateMany({
      where: { id, organisationId: organisation.id },
      data: { ...body, projectId, planningApplicationId, buildingWarrantApplicationId },
    });
    if (!result.count) throw new HttpError(404, 'Deadline not found.');
    return jsonResponse(200, { ok: true });
  });

export const DELETE: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'deadlines:delete');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Deadline id is required.');
    const result = await prisma.deadline.deleteMany({ where: { id, organisationId: organisation.id } });
    if (!result.count) throw new HttpError(404, 'Deadline not found.');
    return jsonResponse(200, { ok: true });
  }, context);