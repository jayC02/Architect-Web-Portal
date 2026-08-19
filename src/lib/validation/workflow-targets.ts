import { WorkflowTargetKey } from '@prisma/client';
import { z } from 'zod';

export const workflowTargetsUpdateSchema = z.object({
  targets: z.array(z.object({
    key: z.nativeEnum(WorkflowTargetKey),
    enabled: z.boolean(),
    offsetDays: z.number().int().min(0).max(365),
  }).strict()).length(5),
}).strict();
