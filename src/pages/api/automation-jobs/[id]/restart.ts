export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { restartFailedAutomationJob } from '@/server/services/automation-job-restart.service';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'automation-jobs:restart');
  const { organisation, user } = await requireOrganisation(context);
  const oldJobId = context.params.id;
  if (!oldJobId) throw new HttpError(400, 'Automation job id is required.');

  const { newJob, compatibleAgentOnline } = await restartFailedAutomationJob({
    organisation,
    actor: { id: user.id, name: user.name, email: user.email },
    oldJobId,
  });

  return jsonResponse(201, {
    job: { ...newJob, stale: false },
    compatibleAgentOnline,
  });
}, context);
