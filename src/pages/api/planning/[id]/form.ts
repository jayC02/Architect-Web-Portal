export const prerender = false;

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { PLANNING_FORM_KEYS, type PlanningFormKey } from '@/lib/planning-form';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { choosePlanningForm } from '@/server/services/planning-form.service';

export const planningFormChoiceSchema = z.object({
  form: z.enum(PLANNING_FORM_KEYS as [PlanningFormKey, ...PlanningFormKey[]]),
  expectedJobId: z.string().trim().min(1).max(120).nullable(),
  requestId: z.string().uuid(),
}).strict();

// Changes which ePlanning form the application uses; a prepared run is replaced with one for the new form.
export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'planning:form');
  const { organisation, user } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Planning application id is required.');
  const body = await parseBody(context.request, planningFormChoiceSchema);
  const result = await choosePlanningForm({
    organisation, actor: user, planningApplicationId: id,
    form: body.form, expectedJobId: body.expectedJobId, requestId: body.requestId,
  });
  return jsonResponse(200, { ok: true, ...result });
}, context);
