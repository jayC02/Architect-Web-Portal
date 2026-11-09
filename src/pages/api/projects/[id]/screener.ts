import { persistProjectScreeningChange } from '@/server/services/project-screener.service';
export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { projectScreenerUpdateSchema } from '@/lib/projects/screener';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const PATCH: APIRoute = context => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'projects:screener');
  const { organisation } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Project id is required.');
  const data = await parseBody(context.request, projectScreenerUpdateSchema);
  const result = await persistProjectScreeningChange(prisma, { organisationId: organisation.id, projectId: id, data });
  if (!result.count) throw new HttpError(404, 'Project not found.');
  return jsonResponse(200, { ok: true, redirectTo: `/projects/${id}` });
});
