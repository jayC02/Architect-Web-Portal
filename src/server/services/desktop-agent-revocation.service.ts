import type { Prisma } from '@prisma/client';
import { HttpError } from '@/lib/utils/http';
import { lockOrganisationExecution } from '@/server/services/desktop-execution.service';

export const revokeAgentInTransaction = async (tx: Prisma.TransactionClient, input: {
  organisationId: string; agentId: string; enrolledByUserId?: string;
}) => {
  await lockOrganisationExecution(tx, input.organisationId);
  const agent = await tx.agentRegistration.findFirst({
    where: { id: input.agentId, organisationId: input.organisationId,
      ...(input.enrolledByUserId ? { enrolledByUserId: input.enrolledByUserId } : {}) },
    select: { id: true },
  });
  if (!agent) throw new HttpError(404, 'Architect Pro Agent not found.');
  const revokedAt = new Date();
  await tx.agentRegistration.update({
    where: { id: agent.id },
    data: { enabled: false, revokedAt, operatingState: 'DISCONNECTED' },
  });
  await tx.desktopAccessToken.updateMany({
    where: { organisationId: input.organisationId, revokedAt: null,
      automationJob: { claimedByAgentId: agent.id } },
    data: { revokedAt },
  });
};
