export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisationRole } from '@/server/permissions/authz';

export const DELETE: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'xero:project-invoice-unlink');
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const projectId = context.params.id;
  const xeroInvoiceId = context.params.invoiceId;
  if (!projectId || !xeroInvoiceId) throw new HttpError(400, 'Project and invoice ids are required.');
  await prisma.xeroProjectInvoiceLink.deleteMany({ where: { organisationId: organisation.id, projectId, xeroInvoiceId } });
  return jsonResponse(200, { ok: true });
}, context);
