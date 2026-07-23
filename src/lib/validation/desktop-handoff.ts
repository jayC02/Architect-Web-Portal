import { AutomationJobStatus, AutomationJobType } from '@prisma/client';
import { z } from 'zod';

export const desktopTokenCreateSchema = z.object({
  name: z.string().trim().min(1, 'Enter a device name.').max(80),
});

export const desktopJobCreateSchema = z.object({
  type: z.enum([AutomationJobType.HOUSEHOLDER_PLANNING, AutomationJobType.BUILDING_WARRANT]),
  planningApplicationId: z.string().trim().min(1).max(120).optional(),
  buildingWarrantApplicationId: z.string().trim().min(1).max(120).optional(),
});

export const desktopJobClaimSchema = z.object({
  deviceName: z.string().trim().min(1).max(120).optional(),
});

export const desktopHandoffExchangeSchema = z.object({
  jobId: z.string().trim().min(8).max(120),
  code: z.string().trim().regex(/^aph_[A-Za-z0-9_-]{40,80}$/, 'The desktop handoff code is invalid.'),
  deviceName: z.string().trim().min(1).max(120).optional(),
});

export const desktopJobStatusSchema = z.object({
  status: z.enum([
    AutomationJobStatus.IN_PROGRESS,
    AutomationJobStatus.NEEDS_REVIEW,
    AutomationJobStatus.COMPLETED,
    AutomationJobStatus.FAILED,
  ]),
  resultSummary: z.string().trim().max(1000).optional(),
  error: z.string().trim().max(500).optional(),
});
