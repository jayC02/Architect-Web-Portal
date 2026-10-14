import { ApplicationDraftStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

const nonempty = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

// Reuse the description already reviewed for this project, without replacing an
// application's own corrections or treating general project notes as work details.
export const resolveApplicationDescription = async (
  organisationId: string,
  projectId: string,
  currentDescription?: string | null,
): Promise<string | null> => {
  const current = nonempty(currentDescription);
  if (current) return current;
  const [draft, planning, warrant] = await Promise.all([
    prisma.applicationDraft.findFirst({
      where: { organisationId, resultingProjectId: projectId, status: ApplicationDraftStatus.COMMITTED },
      orderBy: { committedAt: 'desc' }, select: { confirmedData: true, committedAt: true },
    }),
    prisma.planningApplication.findFirst({
      where: { organisationId, projectId, description: { not: null } },
      orderBy: { updatedAt: 'desc' }, select: { description: true, updatedAt: true },
    }),
    prisma.buildingWarrantApplication.findFirst({
      where: { organisationId, projectId, description: { not: null } },
      orderBy: { updatedAt: 'desc' }, select: { description: true, updatedAt: true },
    }),
  ]);
  const review = draft?.confirmedData as { application?: { description?: unknown } } | null;
  return [
    { description: nonempty(review?.application?.description), date: draft?.committedAt },
    { description: nonempty(planning?.description), date: planning?.updatedAt },
    { description: nonempty(warrant?.description), date: warrant?.updatedAt },
  ].filter(value => value.description)
    .sort((left, right) => (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0))[0]?.description ?? null;
};
