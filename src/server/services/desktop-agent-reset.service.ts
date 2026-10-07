import { AutomationJobStatus, type Prisma } from '@prisma/client';
import { HttpError } from '@/lib/utils/http';

// Caller holds the existing organisation execution lock. READY queue entries do
// not belong to an execution; a retained fee handoff must be released first.
export const assertAgentConnectionResettable = async (tx: Prisma.TransactionClient, organisationId: string, agentId: string) => {
  const active = await tx.automationJob.findFirst({ where: {
    organisationId, claimedByAgentId: agentId,
    OR: [
      { status: { in: [AutomationJobStatus.CLAIMED, AutomationJobStatus.IN_PROGRESS, AutomationJobStatus.NEEDS_REVIEW] } },
      { status: AutomationJobStatus.AWAITING_PORTAL_REVIEW, events: { none: { eventType: 'execution_released' } } },
    ],
  }, select: { id: true } });
  if (active) throw new HttpError(409, 'Finish or release the current application in the Agent before resetting its connection. If the application stopped unexpectedly, review it in Architect Pro first.');
};
