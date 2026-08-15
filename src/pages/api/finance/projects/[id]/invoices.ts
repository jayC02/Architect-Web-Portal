export const prerender = false;

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisationRole } from '@/server/permissions/authz';

const schema = z.object({ xeroInvoiceId: z.string().uuid() });

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'xero:project-invoice-link');
  const { organisation, user } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const projectId = context.params.id;
  if (!projectId) throw new HttpError(400, 'Project id is required.');
  const { xeroInvoiceId } = await parseBody(context.request, schema);
  const [project, connection] = await Promise.all([
    prisma.project.findFirst({ where: { id: projectId, organisationId: organisation.id }, select: { id: true } }),
    prisma.xeroConnection.findUnique({ where: { organisationId: organisation.id } }),
  ]);
  if (!project || !connection) throw new HttpError(404, 'Project or Xero connection not found.');
  const invoice = await prisma.xeroInvoiceSnapshot.findUnique({
    where: { connectionId_xeroInvoiceId: { connectionId: connection.id, xeroInvoiceId } },
  });
  if (!invoice || invoice.organisationId !== organisation.id) throw new HttpError(404, 'Xero invoice not found.');
  try {
    await prisma.xeroProjectInvoiceLink.create({
      data: { organisationId: organisation.id, connectionId: connection.id, projectId, xeroInvoiceId, linkedByUserId: user.id },
    });
  } catch {
    throw new HttpError(409, 'That Xero invoice is already linked.');
  }
  return jsonResponse(201, { ok: true });
}, context);
