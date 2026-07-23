export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import {
  buildDesktopLaunchUrl,
  createDesktopHandoffCode,
  desktopHandoffCodeHash,
  desktopHandoffExpiry,
} from '@/server/auth/desktop-token';
import { requireOrganisation } from '@/server/permissions/authz';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'desktop-handoff:launch');
  const { organisation } = await requireOrganisation(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Automation job id is required.');

  const handoffCode = createDesktopHandoffCode();
  const updated = await prisma.automationJob.updateMany({
    where: { id, organisationId: organisation.id, status: AutomationJobStatus.READY },
    data: {
      handoffCodeHash: desktopHandoffCodeHash(handoffCode),
      handoffExpiresAt: desktopHandoffExpiry(),
      handoffRedeemedAt: null,
    },
  });
  if (!updated.count) throw new HttpError(409, 'This automation job is no longer ready to open.');

  return jsonResponse(200, {
    launchUrl: buildDesktopLaunchUrl(id, handoffCode, context.url.origin),
  });
}, context);
