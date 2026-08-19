import {
  ActionItemKind,
  ActionItemPriority,
  ActionItemStatus,
  AgentOperatingState,
  AutomationJobStatus,
  AutomationJobType,
  type AgentRegistration,
  type PrismaClient,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { DESKTOP_CALLBACK_CONTRACT_VERSION } from '@/lib/validation/desktop-handoff';
import {
  DESKTOP_PROGRESS_CONTRACT_VERSION,
  type AgentCapabilities,
  agentCapabilitiesSchema,
} from '@/lib/validation/desktop-agent';

export const AGENT_HEALTHY_MS = 90_000;
export const AGENT_LEASE_MS = 120_000;

export const parseAgentCapabilities = (value: unknown) => agentCapabilitiesSchema.safeParse(value);

export const agentSupportsJob = (
  agent: Pick<AgentRegistration, 'capabilities'>,
  job: { type: AutomationJobType; payloadVersion: number },
) => {
  const parsed = parseAgentCapabilities(agent.capabilities);
  if (!parsed.success) return false;
  const capabilities: AgentCapabilities = parsed.data;
  return capabilities.workflows.includes(job.type as never)
    && capabilities.snapshotVersions.includes(job.payloadVersion)
    && capabilities.callbackContractVersions.includes(DESKTOP_CALLBACK_CONTRACT_VERSION)
    && capabilities.progressContractVersions.includes(DESKTOP_PROGRESS_CONTRACT_VERSION);
};

export const healthyAgentCutoff = (now = new Date()) => new Date(now.getTime() - AGENT_HEALTHY_MS);
export const agentLeaseExpiry = (now = new Date()) => new Date(now.getTime() + AGENT_LEASE_MS);
export const waitingAgentActionKey = (jobId: string) => `automation:${jobId}:waiting-agent`;
export const connectionLostActionKey = (jobId: string) => `automation:${jobId}:connection-lost`;

export const ensureWaitingForAgentAction = async (
  database: PrismaClient,
  job: { id: string; organisationId: string; projectId: string; type: AutomationJobType },
  title = 'Waiting for Architect Pro Agent',
) => database.actionItem.upsert({
  where: { organisationId_dedupeKey: { organisationId: job.organisationId, dedupeKey: waitingAgentActionKey(job.id) } },
  update: { title, status: ActionItemStatus.OPEN, resolvedAt: null },
  create: {
    organisationId: job.organisationId,
    projectId: job.projectId,
    kind: ActionItemKind.DESKTOP_AUTOMATION,
    title,
    summary: 'Connect a compatible Architect Pro Agent to start this authorised application automatically.',
    actionUrl: `/projects/${job.projectId}#${job.type === AutomationJobType.BUILDING_WARRANT ? 'building-warrant' : 'planning'}`,
    priority: ActionItemPriority.MEDIUM,
    dedupeKey: waitingAgentActionKey(job.id),
  },
});

export const resolveAgentAction = (database: PrismaClient, organisationId: string, dedupeKey: string, now = new Date()) =>
  database.actionItem.updateMany({
    where: { organisationId, dedupeKey, status: ActionItemStatus.OPEN },
    data: { status: ActionItemStatus.RESOLVED, resolvedAt: now },
  });

export const reconcileStaleAgentJobs = async (input: {
  organisationId?: string;
  now?: Date;
  database?: PrismaClient;
} = {}) => {
  const database = input.database ?? prisma;
  const now = input.now ?? new Date();
  const expired = await database.automationJob.findMany({
    where: {
      ...(input.organisationId ? { organisationId: input.organisationId } : {}),
      claimedByAgentId: { not: null },
      leaseExpiresAt: { lte: now },
      status: { in: [AutomationJobStatus.CLAIMED, AutomationJobStatus.IN_PROGRESS] },
    },
    select: { id: true, organisationId: true, projectId: true, type: true, status: true, claimedByAgentId: true },
    take: 50,
  });
  let returnedReady = 0;
  let needsReview = 0;
  for (const job of expired) {
    if (job.status === AutomationJobStatus.CLAIMED) {
      const released = await database.automationJob.updateMany({
        where: { id: job.id, status: AutomationJobStatus.CLAIMED, claimedByAgentId: job.claimedByAgentId, leaseExpiresAt: { lte: now } },
        data: {
          status: AutomationJobStatus.READY,
          claimedByAgentId: null,
          claimedDeviceId: null,
          claimedByUserId: null,
          claimedAt: null,
          agentRunId: null,
          leaseExpiresAt: null,
          agentHeartbeatAt: null,
        },
      });
      if (released.count) {
        await database.desktopAccessToken.updateMany({ where: { automationJobId: job.id, revokedAt: null }, data: { revokedAt: now } });
        await ensureWaitingForAgentAction(database, job);
        returnedReady += 1;
      }
      continue;
    }
    const stopped = await database.automationJob.updateMany({
      where: { id: job.id, status: AutomationJobStatus.IN_PROGRESS, claimedByAgentId: job.claimedByAgentId, leaseExpiresAt: { lte: now } },
      data: {
        status: AutomationJobStatus.NEEDS_REVIEW,
        leaseExpiresAt: null,
        progressStageState: 'connection_lost',
        progressMessage: 'Agent connection lost',
        progressUpdatedAt: now,
      },
    });
    if (stopped.count) {
      const dedupeKey = connectionLostActionKey(job.id);
      await database.actionItem.upsert({
        where: { organisationId_dedupeKey: { organisationId: job.organisationId, dedupeKey } },
        update: { status: ActionItemStatus.OPEN, resolvedAt: null },
        create: {
          organisationId: job.organisationId,
          projectId: job.projectId,
          kind: ActionItemKind.DESKTOP_AUTOMATION,
          title: 'Desktop automation connection lost — review application',
          summary: 'The portal may already have accepted actions. Review the existing browser/application before deciding how to continue.',
          actionUrl: `/projects/${job.projectId}`,
          priority: ActionItemPriority.HIGH,
          dedupeKey,
        },
      });
      needsReview += 1;
    }
  }
  return { returnedReady, needsReview };
};

export const heartbeatStateForProgress = (stage: string) => stage === 'address_selection' || stage === 'fee'
  ? AgentOperatingState.USER_ACTION_REQUIRED
  : AgentOperatingState.RUNNING;

