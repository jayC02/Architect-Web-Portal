export const prerender = false;
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { enqueueProjectDocumentProcessing } from '@/server/services/document-processing.service';

export const GET: APIRoute = context => withErrorHandling(async () => {
  const { organisation } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id || !await prisma.projectDocument.findFirst({ where: { id, organisationId: organisation.id }, select: { id: true } })) throw new HttpError(404, 'Document not found.');
  const jobs = await prisma.documentProcessingJob.findMany({ where: { projectDocumentId: id, organisationId: organisation.id }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, state: true, attempts: true, nextAttemptAt: true, failureCode: true, failureMessage: true } });
  return jsonResponse(200, { jobs });
}, context);

export const POST: APIRoute = context => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  const { organisation } = await requireOrganisation(context);
  assertRateLimit(context, rateLimitPolicies.mutation, 'documents:retry-analysis');
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Document id is required.');
  const job = await enqueueProjectDocumentProcessing(id, organisation.id, { retry: true });
  const { startDocumentWorker } = await import('@/server/services/document-worker-start.service');
  startDocumentWorker(organisation.id);
  return jsonResponse(202, { job: job && { id: job.id, state: job.state, attempts: job.attempts } });
}, context);
