import { AutomationJobStatus, AutomationJobType, type Prisma, type PrismaClient } from '@prisma/client';
import { HttpError } from '@/lib/utils/http';

export const persistProjectScreeningChange = async (
  database: PrismaClient,
  input: { organisationId: string; projectId: string; data: Prisma.ProjectUpdateManyMutationInput },
) => database.$transaction(async tx => {
  const result = await tx.project.updateMany({
    where: { id: input.projectId, organisationId: input.organisationId }, data: input.data,
  });
  if (!result.count) throw new HttpError(404, 'Project not found.');
  // Approved/running snapshots remain immutable; unstarted reviews need fresh screening.
  await tx.automationJob.updateMany({
    where: {
      organisationId: input.organisationId, projectId: input.projectId,
      type: AutomationJobType.BUILDING_WARRANT, status: AutomationJobStatus.READY,
      executionAuthorisedAt: null, claimedAt: null, claimedDeviceId: null, claimedByUserId: null, claimedByAgentId: null, agentRunId: null,
    },
    data: { status: AutomationJobStatus.STALE },
  });
  return result;
});
