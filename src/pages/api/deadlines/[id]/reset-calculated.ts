export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { syncDeadlineToGoogleBestEffort } from '@/lib/integrations/google-calendar';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { resetWorkflowDeadlineToCalculated } from '@/server/services/workflow-deadlines.service';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'deadlines:reset-calculated');
  const { organisation } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Deadline id is required.');
  const deadline = await prisma.$transaction((tx) =>
    resetWorkflowDeadlineToCalculated(tx, organisation.id, id));
  if (!deadline) throw new HttpError(404, 'Workflow-managed deadline with a calculated date not found.');
  const calendarSync = await syncDeadlineToGoogleBestEffort(organisation.id, deadline.id);
  return jsonResponse(200, {
    ok: true,
    message: 'Workflow reminder reset to its calculated date.',
    calendarSync,
  });
}, context);
