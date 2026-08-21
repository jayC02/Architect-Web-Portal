import type { LifecycleEvent, PrismaClient, WorkflowEffect } from '@prisma/client';
import type {
  reconcileLifecycleCalendarMilestoneBestEffort,
  syncDeadlineToGoogleBestEffort,
} from '@/lib/integrations/google-calendar';

export type EffectWithEvent = WorkflowEffect & { lifecycleEvent: LifecycleEvent };
export type EffectExecutionDependencies = {
  database: PrismaClient;
  calendarSync: typeof syncDeadlineToGoogleBestEffort;
  calendarMilestoneSync: typeof reconcileLifecycleCalendarMilestoneBestEffort;
};
export type EffectHandler = (
  effect: EffectWithEvent,
  dependencies: EffectExecutionDependencies,
) => Promise<void>;
