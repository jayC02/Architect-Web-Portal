export const prerender = false;

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisationRole } from '@/server/permissions/authz';

const settingsSchema = z.object({
  enabled: z.boolean(),
  requireReview: z.boolean().default(true),
  autoApplyHighConfidence: z.boolean().default(false),
}).refine((value) => !(value.requireReview && value.autoApplyHighConfidence), {
  message: 'Automatic updates cannot be enabled while every update requires review.',
});

export const PATCH: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'gmail:settings');
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const body = await parseBody(context.request, settingsSchema);
  const connection = await prisma.calendarConnection.findUnique({
    where: { organisationId_provider: { organisationId: organisation.id, provider: 'GOOGLE' } },
    select: { id: true, grantedScopes: true },
  });
  if (!connection) throw new HttpError(409, 'Connect Google before enabling Gmail tracking.');
  const hasGmail = connection.grantedScopes?.split(/\s+/).includes('https://www.googleapis.com/auth/gmail.readonly');
  if (body.enabled && !hasGmail) throw new HttpError(409, 'Approve Gmail read access before enabling tracking.');
  await prisma.calendarConnection.update({
    where: { id: connection.id },
    data: {
      gmailEnabled: body.enabled,
      gmailRequireReview: body.requireReview,
      gmailAutoApplyHighConfidence: body.autoApplyHighConfidence,
      gmailSyncError: body.enabled ? undefined : null,
      gmailSyncStartedAt: body.enabled ? undefined : null,
    },
  });
  return jsonResponse(200, { ok: true });
}, context);
