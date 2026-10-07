export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { requireOrganisation } from '@/server/permissions/authz';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  const { organisation } = await requireOrganisation(context);
  const select = {
    id: true, title: true, type: true, status: true, executionAuthorisedAt: true,
    progressPercent: true, progressMessage: true, progressUpdatedAt: true,
    project: { select: { id: true, name: true } },
  } as const;
  const [active, recent] = await Promise.all([
    prisma.automationJob.findMany({
      where: {
        organisationId: organisation.id,
        OR: [
          { status: 'READY', executionAuthorisedAt: { not: null } },
          { status: { in: ['CLAIMED', 'IN_PROGRESS'] } },
        ],
      },
      select,
      orderBy: [{ executionAuthorisedAt: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.automationJob.findMany({
      where: {
        organisationId: organisation.id,
        status: { in: ['NEEDS_REVIEW', 'AWAITING_PORTAL_REVIEW', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'FAILED', 'COMPLETED'] },
      },
      select,
      orderBy: { updatedAt: 'desc' },
      take: 10,
    }),
  ]);
  return jsonResponse(200, { active, recent });
}, context);

