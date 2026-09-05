import { AutomationJobStatus, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';
import {
  agentSupportsJob,
  ensureWaitingForAgentAction,
  healthyAgentCutoff,
} from '@/server/services/desktop-agent.service';

export const authoriseAutomationJobRun = async (input: {
  organisationId: string;
  jobId: string;
  authorisedAt?: Date;
  database?: PrismaClient;
}) => {
  const database = input.database ?? prisma;
  const authorisedAt = input.authorisedAt ?? new Date();
  const job = await database.automationJob.findFirst({
    where: {
      id: input.jobId,
      organisationId: input.organisationId,
      status: AutomationJobStatus.READY,
    },
    select: {
      id: true,
      organisationId: true,
      projectId: true,
      type: true,
      payloadVersion: true,
    },
  });
  if (!job) throw new HttpError(409, 'This application is not ready to run.');

  const authorised = await database.automationJob.updateMany({
    where: {
      id: input.jobId,
      organisationId: input.organisationId,
      status: AutomationJobStatus.READY,
    },
    data: { executionAuthorisedAt: authorisedAt },
  });
  if (!authorised.count) {
    throw new HttpError(409, 'This application changed before it could be authorised.');
  }

  const agents = await database.agentRegistration.findMany({
    where: {
      organisationId: input.organisationId,
      enabled: true,
      revokedAt: null,
      lastSeenAt: { gt: healthyAgentCutoff(authorisedAt) },
    },
  });
  const compatible = agents.some((agent) => agentSupportsJob(agent, job));
  if (!compatible) {
    await ensureWaitingForAgentAction(
      database,
      job,
      agents.length ? 'Architect Pro Agent update required' : 'Waiting for Architect Pro Agent',
    );
  }

  return { compatibleAgentOnline: compatible };
};
