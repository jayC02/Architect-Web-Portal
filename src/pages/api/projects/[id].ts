export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { projectSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

const assertRelatedRecord = async (organisationId: string, model: 'client' | 'site', id: string | undefined) => {
  if (!id) return null;
  const record =
    model === 'client'
      ? await prisma.client.findFirst({ where: { id, organisationId }, select: { id: true } })
      : await prisma.site.findFirst({ where: { id, organisationId }, select: { id: true } });
  if (!record) throw new HttpError(400, `${model} does not belong to this organisation.`);
  return id;
};

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Project id is required.');
    const project = await prisma.project.findFirst({
      where: { id, organisationId: organisation.id },
      include: {
        client: true,
        site: true,
        documents: { orderBy: { createdAt: 'desc' }, take: 20 },
        planningApplications: { orderBy: { updatedAt: 'desc' } },
        warrantApplications: { orderBy: { updatedAt: 'desc' } },
        deadlines: { orderBy: { dueDate: 'asc' }, take: 20 },
        submissionPackages: { orderBy: { updatedAt: 'desc' } },
      },
    });
    if (!project) throw new HttpError(404, 'Project not found.');
    return jsonResponse(200, { project });
  });

export const PATCH: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'projects:update');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Project id is required.');
    const body = await parseBody(context.request, projectSchema);
    const clientId = await assertRelatedRecord(organisation.id, 'client', body.clientId);
    const siteId = await assertRelatedRecord(organisation.id, 'site', body.siteId);
    const result = await prisma.project.updateMany({
      where: { id, organisationId: organisation.id },
      data: { ...body, clientId, siteId },
    });
    if (!result.count) throw new HttpError(404, 'Project not found.');
    return jsonResponse(200, { ok: true });
  });

export const DELETE: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'projects:delete');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Project id is required.');
    const result = await prisma.project.deleteMany({ where: { id, organisationId: organisation.id } });
    if (!result.count) throw new HttpError(404, 'Project not found.');
    return jsonResponse(200, { ok: true });
  }, context);