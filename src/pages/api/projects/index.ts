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
  if (!id) return undefined;
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
    const projects = await prisma.project.findMany({
      where: { organisationId: organisation.id },
      include: { client: true, site: true },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return jsonResponse(200, { projects });
  });

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'projects:create');
    const { organisation } = await requireOrganisation(context);
    const body = await parseBody(context.request, projectSchema);
    const clientId = await assertRelatedRecord(organisation.id, 'client', body.clientId);
    const siteId = await assertRelatedRecord(organisation.id, 'site', body.siteId);
    const project = await prisma.project.create({
      data: { ...body, clientId, siteId, organisationId: organisation.id },
    });
    return jsonResponse(201, { project });
  });
