export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { desktopJobClaimSchema } from '@/lib/validation/desktop-handoff';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { assertDesktopJobAccess, requireDesktopAuth } from '@/server/auth/desktop-token';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-job:claim');
  const access = await requireDesktopAuth(context);
  const id = context.params.id;
  if (!id) throw new HttpError(400, 'Automation job id is required.');
  assertDesktopJobAccess(access, id);
  await parseBody(context.request, desktopJobClaimSchema);

  const existing = await prisma.automationJob.findFirst({
    where: { id, organisationId: access.organisationId },
    select: { id: true, status: true, claimedDeviceId: true },
  });
  if (!existing) throw new HttpError(404, 'Automation job not found.');
  if (existing.claimedDeviceId && existing.claimedDeviceId !== access.id) {
    throw new HttpError(409, 'This automation job is already open on another desktop device.');
  }
  if (existing.status !== AutomationJobStatus.READY && existing.status !== AutomationJobStatus.CLAIMED) {
    throw new HttpError(409, 'This automation job is no longer ready to be claimed.');
  }

  const claimed = await prisma.automationJob.updateMany({
    where: {
      id,
      organisationId: access.organisationId,
      status: { in: [AutomationJobStatus.READY, AutomationJobStatus.CLAIMED] },
      OR: [{ claimedDeviceId: null }, { claimedDeviceId: access.id }],
    },
    data: {
      status: AutomationJobStatus.CLAIMED,
      claimedDeviceId: access.id,
      claimedByUserId: access.userId,
      claimedAt: existing.claimedDeviceId ? undefined : new Date(),
    },
  });
  if (!claimed.count) throw new HttpError(409, 'This automation job was claimed by another device.');
  return jsonResponse(200, { ok: true, status: AutomationJobStatus.CLAIMED });
}, context);
