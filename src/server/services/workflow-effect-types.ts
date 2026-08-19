import type { LifecycleEvent, PrismaClient, WorkflowEffect } from '@prisma/client';
import type { syncDeadlineToGoogleBestEffort } from '@/lib/integrations/google-calendar';

export type EffectWithEvent = WorkflowEffect & { lifecycleEvent: LifecycleEvent };
export type EffectExecutionDependencies = {
  database: PrismaClient;
  calendarSync: typeof syncDeadlineToGoogleBestEffort;
};
export type EffectHandler = (
  effect: EffectWithEvent,
  dependencies: EffectExecutionDependencies,
) => Promise<void>;
