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
  if (!id) return undefined;
  const record =
    model === 'project'
      ? await prisma.project.findFirst({ where: { id, organisationId }, select: { id: true } })
      : model === 'planning'
        ? await prisma.planningApplication.findFirst({ where: { id, organisationId }, select: { id: true } })
        : await prisma.buildingWarrantApplication.findFirst({ where: { id, organisationId }, select: { id: true } });
  if (!record) throw new HttpError(400, `${model} link does not belong to this organisation.`);
  return id;
};

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const deadlines = await prisma.deadline.findMany({
      where: { organisationId: organisation.id },
      include: { project: { select: { id: true, name: true } } },
      orderBy: { dueDate: 'asc' },
      take: 150,
    });
    return jsonResponse(200, { deadlines });
  });

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'deadlines:create');
    const { organisation } = await requireOrganisation(context);
    const body = await parseBody(context.request, deadlineSchema);
    const projectId = await assertScopedOptional(organisation.id, 'project', body.projectId);
    const planningApplicationId = await assertScopedOptional(organisation.id, 'planning', body.planningApplicationId);
    const buildingWarrantApplicationId = await assertScopedOptional(organisation.id, 'warrant', body.buildingWarrantApplicationId);
    const deadline = await prisma.deadline.create({
      data: {
        ...body,
        projectId,
        planningApplicationId,
        buildingWarrantApplicationId,
        organisationId: organisation.id,
      },
    });
    return jsonResponse(201, { deadline });
  });
