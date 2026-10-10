export const prerender = false;
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { analyseStoredProjectDocument } from '@/server/services/project-document-analysis.service';

export const GET: APIRoute = context => withErrorHandling(async () => {
  const { organisation } = await requireOrganisation(context);
  const id = context.params.id;
  const document = id ? await prisma.projectDocument.findFirst({ where: { id, organisationId: organisation.id }, select: { id: true, analysisStatus: true, analysedAt: true } }) : null;
  if (!document) throw new HttpError(404, 'Document not found.');
  return jsonResponse(200, { document });
}, context);

export const POST: APIRoute = context => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  const { organisation } = await requireOrganisation(context);
  assertRateLimit(context, rateLimitPolicies.mutation, 'documents:retry-analysis');
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Document id is required.');
  const document = await analyseStoredProjectDocument(id, organisation.id);
  return jsonResponse(200, { document });
}, context);
