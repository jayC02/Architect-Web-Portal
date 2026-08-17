import { LifecycleEventSource, type Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { emitProjectCreatedLifecycleEvent } from '@/server/services/lifecycle-events.service';

export const createProjectWithLifecycle = async (
  input: {
    data: Prisma.ProjectUncheckedCreateInput;
    actorUserId: string;
    source?: LifecycleEventSource;
  },
  database: PrismaClient = prisma,
) => database.$transaction(async (tx) => {
  const project = await tx.project.create({ data: input.data });
  const lifecycleEvent = await emitProjectCreatedLifecycleEvent(tx, {
    organisationId: project.organisationId,
    project,
    source: input.source ?? LifecycleEventSource.MANUAL_PROJECT,
    actorUserId: input.actorUserId,
  });
  return { project, lifecycleEventId: lifecycleEvent.id };
});
