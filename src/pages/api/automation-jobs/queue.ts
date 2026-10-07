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
  const active = await prisma.automationJob.findMany({
    where: {
      organisationId: organisation.id,
      OR: [
        { status: 'READY', executionAuthorisedAt: { not: null } },
        { status: { in: ['CLAIMED', 'IN_PROGRESS'] } },
      ],
    },
    select,
    orderBy: [{ executionAuthorisedAt: 'asc' }, { createdAt: 'asc' }],
  });
  active.sort((left, right) => Number(left.status === 'READY') - Number(right.status === 'READY'));
  return jsonResponse(200, { active });
}, context);
