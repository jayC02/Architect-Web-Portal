export const prerender = false;
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireOrganisation, requireProjectAccess } from '@/server/permissions/authz';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertAuthenticatedUploadLimit } from '@/server/services/upload-limits.service';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { reserveProjectUpload } from '@/server/services/project-upload.service';
const schema = z.object({ filename: z.string().min(1).max(180), mimeType: z.string().min(1).max(160), size: z.number().int().positive(), clientSha256: z.string().regex(/^[a-f0-9]{64}$/), clientUploadId: z.string().uuid().optional(), metadata: z.record(z.unknown()).optional() }).strict();
export const GET: APIRoute = context => withErrorHandling(async () => {
  const { organisation } = await requireOrganisation(context);
  if (!context.params.id) throw new HttpError(400, 'Project id is required.');
  await requireProjectAccess(organisation.id, context.params.id);
  const documents = await prisma.projectUploadIntent.findMany({ where: { organisationId: organisation.id, projectId: context.params.id, projectDocumentId: null, cancelledAt: null }, select: { id: true, originalFilename: true, sizeBytes: true, status: true }, orderBy: { createdAt: 'desc' }, take: 50 });
  return jsonResponse(200, { documents });
}, context);
export const POST: APIRoute = context => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  const { user, organisation } = await requireOrganisation(context);
  await assertAuthenticatedUploadLimit(context, organisation.id, user.id);
  if (!context.params.id) throw new HttpError(400, 'Project id is required.');
  const input = await parseBody(context.request, schema);
  return jsonResponse(201, await reserveProjectUpload(organisation.id, user.id, context.params.id, input));
}, context);
