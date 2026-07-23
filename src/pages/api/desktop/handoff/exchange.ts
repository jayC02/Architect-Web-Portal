export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { desktopHandoffExchangeSchema } from '@/lib/validation/desktop-handoff';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import {
  createDesktopTokenValue,
  desktopHandoffCodeHash,
  desktopJobTokenExpiry,
  desktopTokenHash,
  desktopTokenPrefix,
} from '@/server/auth/desktop-token';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-handoff:exchange');
  const body = await parseBody(context.request, desktopHandoffExchangeSchema);
  const now = new Date();
  const codeHash = desktopHandoffCodeHash(body.code);
  const accessToken = createDesktopTokenValue();
  const expiresAt = desktopJobTokenExpiry();

  const result = await prisma.$transaction(async (tx) => {
    const job = await tx.automationJob.findFirst({
      where: {
        id: body.jobId,
        handoffCodeHash: codeHash,
        handoffRedeemedAt: null,
        handoffExpiresAt: { gt: now },
        status: AutomationJobStatus.READY,
      },
      select: { id: true, organisationId: true, createdById: true },
    });
    if (!job) {
      throw new HttpError(410, 'This desktop link has expired or has already been used. Return to the portal and open the job again.');
    }

    const access = await tx.desktopAccessToken.create({
      data: {
        organisationId: job.organisationId,
        userId: job.createdById,
        automationJobId: job.id,
        name: body.deviceName || 'ArchitectPro Desktop',
        tokenHash: desktopTokenHash(accessToken),
        tokenPrefix: desktopTokenPrefix(accessToken),
        expiresAt,
      },
      select: { id: true },
    });

    const claimed = await tx.automationJob.updateMany({
      where: {
        id: job.id,
        handoffCodeHash: codeHash,
        handoffRedeemedAt: null,
        handoffExpiresAt: { gt: now },
        status: AutomationJobStatus.READY,
      },
      data: {
        status: AutomationJobStatus.CLAIMED,
        claimedDeviceId: access.id,
        claimedByUserId: job.createdById,
        claimedAt: now,
        handoffCodeHash: null,
        handoffExpiresAt: null,
        handoffRedeemedAt: now,
      },
    });
    if (!claimed.count) {
      throw new HttpError(410, 'This desktop link has already been used. Return to the portal and open the job again.');
    }
    return access;
  });

  return jsonResponse(200, {
    accessToken,
    jobId: body.jobId,
    deviceId: result.id,
    expiresAt: expiresAt.toISOString(),
  });
}, context);
