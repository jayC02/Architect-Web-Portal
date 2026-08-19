export const prerender = false;

import { AutomationJobStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireAgentAuth } from '@/server/auth/agent-credential';
import { agentSupportsJob, reconcileStaleAgentJobs } from '@/server/services/desktop-agent.service';

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-agent:queue');
  const agent = await requireAgentAuth(context);
  await reconcileStaleAgentJobs({ organisationId: agent.organisationId });
  const candidates = await prisma.automationJob.findMany({
    where: {
      organisationId: agent.organisationId,
      status: AutomationJobStatus.READY,
      executionAuthorisedAt: { not: null },
    },
    select: { id: true, type: true, payloadVersion: true, createdAt: true },
    orderBy: [{ executionAuthorisedAt: 'asc' }, { createdAt: 'asc' }],
    take: 20,
  });
  return jsonResponse(200, {
    jobs: candidates.filter((job) => agentSupportsJob(agent, job)).map((job) => ({
      id: job.id,
      workflowType: job.type,
      snapshotVersion: job.payloadVersion,
      callbackContractVersion: 1,
      progressContractVersion: 1,
    })),
    pollAfterSeconds: 25,
  });
}, context);

