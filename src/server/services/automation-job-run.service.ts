import { recordAuthorisedSnapshot } from '@/server/services/automation-state-model.service';
import { AutomationJobStatus, AutomationJobType, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';
import { agentPhoneError } from '@/lib/validation/client-contact';
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
      dataSnapshot: true,
      snapshotHash: true,
    },
  });
  if (!job) throw new HttpError(409, 'This application is not ready to run.');

  if (job.type === AutomationJobType.BUILDING_WARRANT || job.type === AutomationJobType.HOUSEHOLDER_PLANNING || job.type === AutomationJobType.PLANNING_APPLICATION) {
    const phone = (job.dataSnapshot as { organisation?: { agent?: { phone?: unknown } } } | null)?.organisation?.agent?.phone;
    const phoneError = agentPhoneError(typeof phone === 'string' ? phone : null);
    if (phoneError) throw new HttpError(409, `${phoneError} Complete the agent details in the web portal and prepare this application again.`, { field: 'agentPhone' });
  }

  await database.$transaction(async (tx) => {
    const authorised = await tx.automationJob.updateMany({
      where: {
        id: input.jobId,
        organisationId: input.organisationId,
        status: AutomationJobStatus.READY,
        snapshotHash: job.snapshotHash,
      },
      data: { executionAuthorisedAt: authorisedAt },
    });
    if (!authorised.count) {
      throw new HttpError(409, 'This application changed before it could be authorised.');
    }
    await recordAuthorisedSnapshot(tx, { organisationId: input.organisationId, jobId: input.jobId });
  });

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
