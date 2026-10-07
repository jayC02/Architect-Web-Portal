export const prerender = false;
import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { removeWaitingAutomationJob } from '@/server/services/automation-queue.service';

export const DELETE: APIRoute = context => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'automation-jobs:remove-queue');
  const { organisation, user } = await requireOrganisation(context);
  if (!context.params.id) throw new HttpError(400, 'Automation job id is required.');
  await removeWaitingAutomationJob({ organisationId: organisation.id, userId: user.id, jobId: context.params.id });
  return jsonResponse(200, { ok: true });
}, context);
