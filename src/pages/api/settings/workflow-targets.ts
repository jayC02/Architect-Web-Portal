export const prerender = false;

import { OrganisationRole } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { workflowTargetsUpdateSchema } from '@/lib/validation/workflow-targets';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisation, requireOrganisationRole } from '@/server/permissions/authz';
import { getWorkflowTargets, saveWorkflowTargets } from '@/server/services/workflow-targets.service';

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  const { organisation } = await requireOrganisation(context);
  return jsonResponse(200, {
    targets: await getWorkflowTargets(prisma, organisation.id),
  });
}, context);

export const PUT: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'settings:workflow-targets');
  const { organisation } = await requireOrganisationRole(context, [
    OrganisationRole.OWNER,
    OrganisationRole.ADMIN,
  ]);
  const body = await parseBody(context.request, workflowTargetsUpdateSchema);
  const targets = await prisma.$transaction((tx) => saveWorkflowTargets(tx, organisation.id, body.targets));
  return jsonResponse(200, {
    message: 'Automatic workflow reminders saved.',
    targets,
  });
}, context);
