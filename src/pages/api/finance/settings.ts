export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { financeSettingsSchema } from '@/lib/validation/fee-plans';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisationRole } from '@/server/permissions/authz';

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  return jsonResponse(200, { settings: await prisma.organisationFinanceSettings.findUnique({ where: { organisationId: organisation.id } }) });
}, context);

export const PUT: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'finance:settings');
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const input = await parseBody(context.request, financeSettingsSchema);
  const settings = await prisma.organisationFinanceSettings.upsert({
    where: { organisationId: organisation.id },
    create: { organisationId: organisation.id, ...input },
    update: input,
  });
  return jsonResponse(200, { settings });
}, context);
