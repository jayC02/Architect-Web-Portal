export const prerender = false;
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { requireOrganisation, requireProjectAccess } from '@/server/permissions/authz';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
export const DELETE: APIRoute = context => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  const { organisation } = await requireOrganisation(context);
  if (!context.params.id || !context.params.intentId) throw new HttpError(400, 'Project and upload ids are required.');
  await requireProjectAccess(organisation.id, context.params.id);
  const changed = await prisma.projectUploadIntent.updateMany({ where: { id: context.params.intentId, organisationId: organisation.id, projectId: context.params.id, projectDocumentId: null }, data: { cancelledAt: new Date(), status: 'CANCELLED' } });
  if (!changed.count) throw new HttpError(409, 'This transfer is already complete. Remove the document from the project if needed.');
  // Retain the tombstone and object key for cleanup of late storage completion.
  return jsonResponse(200, { ok: true });
}, context);
