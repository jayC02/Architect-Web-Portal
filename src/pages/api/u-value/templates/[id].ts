export const prerender = false;
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
export const GET: APIRoute = context => withErrorHandling(async () => {
  const { organisation } = await requireOrganisation(context);
  const template = await prisma.uValueTemplate.findFirst({ where: { id: context.params.id, organisationId: organisation.id }, select: { id: true, name: true, inputSnapshot: true } });
  if (!template) throw new HttpError(404, 'Construction template not found.');
  return jsonResponse(200, { template });
}, context);
