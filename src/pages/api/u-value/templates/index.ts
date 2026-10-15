export const prerender = false;
import type { APIRoute } from 'astro';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { uValueInputSchema } from '@/lib/u-value/calculator';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
const schema = z.object({ calculationId: z.string().min(1).max(120), name: z.string().trim().min(1).max(160) }).strict();
export const POST: APIRoute = context => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'u-value:template');
  const { organisation, user } = await requireOrganisation(context);
  const body = schema.parse(await context.request.json().catch(() => ({})));
  const calculation = await prisma.uValueCalculation.findFirst({ where: { id: body.calculationId, organisationId: organisation.id } });
  if (!calculation) throw new HttpError(404, 'Calculation not found.');
  const input = uValueInputSchema.parse(calculation.inputSnapshot);
  // Templates carry construction data only. Every use needs a fresh assessment.
  input.correctionsAssessed = false; input.target = null; input.targetReference = '';
  if (input.methodData) input.methodData.applicabilityConfirmed = false;
  const template = await prisma.uValueTemplate.upsert({
    where: { organisationId_sourceCalculationId_name: { organisationId: organisation.id, sourceCalculationId: calculation.id, name: body.name } }, update: {},
    create: { organisationId: organisation.id, sourceCalculationId: calculation.id, name: body.name, createdByName: user.name, inputSnapshot: input as Prisma.InputJsonValue },
  });
  return jsonResponse(201, { template: { id: template.id, name: template.name } });
}, context);
