export const prerender = false;

import { AutomationJobStatus, type Prisma } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireAgentAuth } from '@/server/auth/agent-credential';
import { agentSupportsJob, reconcileStaleAgentJobs } from '@/server/services/desktop-agent.service';

const pageSize = 20;
const jobFields = { id: true, type: true, payloadVersion: true, createdAt: true, executionAuthorisedAt: true, dataSnapshot: true } as const;
type QueueJob = Prisma.AutomationJobGetPayload<{ select: typeof jobFields }>;

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-agent:queue');
  const agent = await requireAgentAuth(context);
  await reconcileStaleAgentJobs({ organisationId: agent.organisationId });
  const compatible: QueueJob[] = [];
  let after: QueueJob | undefined;
  while (compatible.length < pageSize) {
    const candidates: QueueJob[] = await prisma.automationJob.findMany({
      where: {
        organisationId: agent.organisationId,
        status: AutomationJobStatus.READY,
        executionAuthorisedAt: { not: null },
        // Keep scanning even if the last job in the previous page has been claimed or removed.
        ...(after?.executionAuthorisedAt ? { OR: [
          { executionAuthorisedAt: { gt: after.executionAuthorisedAt } },
          { executionAuthorisedAt: after.executionAuthorisedAt, createdAt: { gt: after.createdAt } },
          { executionAuthorisedAt: after.executionAuthorisedAt, createdAt: after.createdAt, id: { gt: after.id } },
        ] } : {}),
      },
      select: jobFields,
      orderBy: [{ executionAuthorisedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: pageSize,
    });
    compatible.push(...candidates.filter(job => agentSupportsJob(agent, job)));
    if (candidates.length < pageSize) break;
    after = candidates.at(-1);
  }
  return jsonResponse(200, {
    jobs: compatible.slice(0, pageSize).map((job) => ({
      id: job.id,
      workflowType: job.type,
      snapshotVersion: job.payloadVersion,
      callbackContractVersion: 1,
      progressContractVersion: 1,
    })),
    pollAfterSeconds: 25,
  });
}, context);

