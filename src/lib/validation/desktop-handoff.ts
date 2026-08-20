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

export const DESKTOP_CALLBACK_CONTRACT_VERSION = 1 as const;

const desktopCallbackTimingsSchema = z.object({
  totalSeconds: z.number().finite().nonnegative().max(86_400).optional(),
  stageDurationsSeconds: z.record(z.number().finite().nonnegative().max(86_400)).default({}),
}).strict();

export const desktopJobStatusSchema = z.object({
  version: z.literal(DESKTOP_CALLBACK_CONTRACT_VERSION, {
    errorMap: () => ({ message: `Unsupported desktop callback version. Expected ${DESKTOP_CALLBACK_CONTRACT_VERSION}.` }),
  }),
  jobId: z.string().trim().min(8).max(120),
  callbackId: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  status: z.enum([
    AutomationJobStatus.IN_PROGRESS,
    AutomationJobStatus.COMPLETED,
    AutomationJobStatus.AWAITING_PORTAL_REVIEW,
    AutomationJobStatus.FAILED_RETRYABLE,
    AutomationJobStatus.FAILED_FINAL,
    AutomationJobStatus.CANCELLED,
  ]),
  eventType: z.enum(['started', 'checkpoint', 'result']),
  lastCheckpoint: z.string().trim().min(1).max(100).optional(),
  resultSummary: z.string().trim().max(1000).optional(),
  error: z.string().trim().max(500).optional(),
  result: z.object({
    outcome: z.enum([
      'awaiting_user_portal_review',
      'completed_to_final_review',
      'paused_for_manual_input',
      'failed_retryable',
      'failed_final',
      'cancelled',
    ]),
    lastCompletedStep: z.string().trim().max(100).nullable().optional(),
    currentSection: z.string().trim().max(100).nullable().optional(),
    documentsUploaded: z.number().int().nonnegative().max(500).optional(),
    warnings: z.array(z.string().trim().max(300)).max(30).default([]),
    userActionRequired: z.string().trim().max(500).nullable().optional(),
    safeRetryPoint: z.string().trim().max(100).nullable().optional(),
    errorCode: z.string().trim().max(80).nullable().optional(),
    errorSummary: z.string().trim().max(500).nullable().optional(),
    timings: desktopCallbackTimingsSchema.optional(),
  }).strict().optional(),
}).strict();
