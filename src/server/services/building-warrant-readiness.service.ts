import { AutomationJobStatus, AutomationJobType, type PrismaClient } from '@prisma/client';
import { automationJobSnapshotV2Schema } from '@/lib/validation/automation-job';
import { automationJobApplicationId } from '@/server/services/desktop-automation-status.service';

export type BuildingWarrantReadiness =
  | { state: 'READY'; missingCount: 0; title: string; summary: string }
  | { state: 'INCOMPLETE'; missingCount: number; title: string; summary: string }
  | { state: 'BLOCKED'; missingCount: null; title: string; summary: string };

export const readBuildingWarrantReadiness = async (
  database: PrismaClient,
  input: { organisationId: string; projectId: string; buildingWarrantApplicationId: string },
): Promise<BuildingWarrantReadiness> => {
  const jobs = await database.automationJob.findMany({
    where: {
      organisationId: input.organisationId,
      projectId: input.projectId,
      type: AutomationJobType.BUILDING_WARRANT,
    },
    orderBy: { updatedAt: 'desc' },
    take: 25,
    select: { id: true, projectId: true, type: true, status: true, dataSnapshot: true },
  });
  const job = jobs.find((candidate) => automationJobApplicationId(candidate) === input.buildingWarrantApplicationId);
  if (!job) {
    return {
      state: 'BLOCKED',
      missingCount: null,
      title: 'Planning approved — Building Warrant needs project information',
      summary: 'Open the existing Building Warrant and complete its project information.',
    };
  }
  const snapshot = automationJobSnapshotV2Schema.safeParse(job.dataSnapshot);
  if (job.status === AutomationJobStatus.READY) {
    return {
      state: 'READY',
      missingCount: 0,
      title: 'Planning approved — Building Warrant ready',
      summary: 'Final review and run the Building Warrant.',
    };
  }
  const snapshotObject = job.dataSnapshot && typeof job.dataSnapshot === 'object' && !Array.isArray(job.dataSnapshot)
    ? job.dataSnapshot as Record<string, unknown>
    : {};
  const preflight = snapshotObject.preflight && typeof snapshotObject.preflight === 'object' && !Array.isArray(snapshotObject.preflight)
    ? snapshotObject.preflight as Record<string, unknown>
    : {};
  const missingCount = snapshot.success
    ? snapshot.data.preflight.missing.length
    : Array.isArray(preflight.missing) ? preflight.missing.length : 0;
  if (missingCount > 0) {
    return {
      state: 'INCOMPLETE',
      missingCount,
      title: `Planning approved — Building Warrant needs ${missingCount} confirmation${missingCount === 1 ? '' : 's'}`,
      summary: `Complete ${missingCount} deterministic preflight confirmation${missingCount === 1 ? '' : 's'} in the existing Building Warrant.`,
    };
  }
  return {
    state: 'BLOCKED',
    missingCount: null,
    title: 'Planning approved — Building Warrant needs project information',
    summary: 'Open the existing Building Warrant and complete its project information.',
  };
};
