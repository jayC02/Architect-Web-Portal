export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { queueCompletionCertificateJob } from '@/server/services/completion-certificate.service';

/** Confirm the reviewed answers and queue the Completion Certificate for the Agent. */
export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'completion:run');
    const { organisation, user } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Building warrant application id is required.');
    const queued = await queueCompletionCertificateJob({
      organisationId: organisation.id,
      organisationName: organisation.name,
      warrantId: id,
      user: { id: user.id, name: user.name ?? user.email, email: user.email },
    });
    return jsonResponse(200, {
      ok: true,
      jobId: queued.jobId,
      created: queued.created,
      compatibleAgentOnline: queued.compatibleAgentOnline,
      redirectTo: `/automation-job/${queued.jobId}`,
    });
  }, context);
