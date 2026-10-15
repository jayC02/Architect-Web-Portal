export const prerender = false;
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const GET: APIRoute = context => withErrorHandling(async () => {
  const { organisation } = await requireOrganisation(context);
  const calculation = await prisma.uValueCalculation.findFirst({ where: { id: context.params.id, organisationId: organisation.id } });
  if (!calculation) throw new HttpError(404, 'Calculation not found.');
  return jsonResponse(200, { calculation });
}, context);
