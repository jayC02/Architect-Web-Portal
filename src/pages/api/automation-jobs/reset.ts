export const prerender = false;
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { resetAutomationJob } from '@/server/services/automation-job-reset.service';

export const automationResetSchema = z.object({
  type: z.enum(['HOUSEHOLDER_PLANNING', 'BUILDING_WARRANT']),
  applicationId: z.string().trim().min(1).max(120),
  expectedJobId: z.string().trim().min(1).max(120).nullable(),
  requestId: z.string().uuid(),
}).strict();

export const POST: APIRoute = context => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'automation-jobs:reset');
  const { organisation, user } = await requireOrganisation(context);
  const body = await parseBody(context.request, automationResetSchema);
  const job = await resetAutomationJob({ ...body, organisation, actor: user });
  return jsonResponse(200, { ok: true, jobId: job.id });
}, context);
