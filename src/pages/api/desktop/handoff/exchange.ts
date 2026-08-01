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

const exchangeableStatuses = [
  AutomationJobStatus.READY,
  AutomationJobStatus.CLAIMED,
  AutomationJobStatus.IN_PROGRESS,
];

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
        status: { in: exchangeableStatuses },
      },
      select: {
        id: true,
        organisationId: true,
        createdById: true,
        claimedByUserId: true,
        claimedAt: true,
        status: true,
      },
    });
    if (!job) {
      throw new HttpError(410, 'This desktop link has expired or has already been used. Return to the portal and open the job again.');
    }

    await tx.desktopAccessToken.updateMany({
      where: { automationJobId: job.id, revokedAt: null },
      data: { revokedAt: now },
    });
    const access = await tx.desktopAccessToken.create({
      data: {
        organisationId: job.organisationId,
        userId: job.claimedByUserId ?? job.createdById,
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
        status: job.status,
      },
      data: {
        status: job.status === AutomationJobStatus.READY ? AutomationJobStatus.CLAIMED : job.status,
        claimedDeviceId: access.id,
        claimedByUserId: job.claimedByUserId ?? job.createdById,
        claimedAt: job.claimedAt ?? now,
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
