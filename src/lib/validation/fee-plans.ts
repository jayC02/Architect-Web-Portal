import { LifecycleEventType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { moneyDecimal } from '@/lib/fees/agreement';

const amountSchema = z.union([z.string(), z.number()]).transform((value, context) => {
  try { return moneyDecimal(value).toFixed(2); } catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : 'Amount is invalid.' });
    return z.NEVER;
  }
});

export const feeMilestoneSchema = z.object({
  milestoneKey: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/),
  label: z.string().trim().min(1).max(160),
  triggerEventType: z.nativeEnum(LifecycleEventType).nullable(),
  amount: amountSchema,
  invoiceDescription: z.string().trim().min(1).max(1000),
  enabled: z.boolean().default(true),
  percentage: z.union([z.string(), z.number()]).optional(),
  accountCode: z.string().trim().max(20).nullable().optional(),
  taxType: z.string().trim().max(40).nullable().optional(),
  dueDays: z.number().int().min(0).max(365).nullable().optional(),
}).strict();

export const feePlanTemplateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  currency: z.string().trim().toUpperCase().length(3).default('GBP'),
  milestones: z.array(feeMilestoneSchema).min(1).max(30),
}).strict().superRefine((value, context) => {
  const keys = new Set<string>();
  value.milestones.forEach((milestone, index) => {
    if (milestone.percentage !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['milestones', index, 'percentage'], message: 'Set percentages on the project agreement rather than a fixed-amount template.' });
    if (keys.has(milestone.milestoneKey)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['milestones', index, 'milestoneKey'], message: 'Milestone keys must be unique.' });
    keys.add(milestone.milestoneKey);
  });
});

export const projectFeePlanSchema = z.object({
  templateId: z.string().cuid().optional(),
  name: z.string().trim().min(1).max(160).optional(),
  currency: z.string().trim().toUpperCase().length(3).optional(),
  milestones: z.array(feeMilestoneSchema).min(1).max(30).optional(),
  agreedAmount: amountSchema.optional(),
  vatTreatment: z.enum(['STANDARD', 'ZERO', 'EXEMPT', 'NOT_REGISTERED', 'LEGACY_UNKNOWN']).optional(),
  vatRate: z.union([z.string(), z.number()]).transform((value, context) => {
    if (!/^\d+(\.\d{1,2})?$/.test(String(value)) || new Prisma.Decimal(value).gt(100)) { context.addIssue({ code: z.ZodIssueCode.custom, message: 'VAT rate must be between 0 and 100.' }); return z.NEVER; }
    return new Prisma.Decimal(value).toFixed(2);
  }).optional(),
  revision: z.number().int().nonnegative().optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict().refine((value) => !(value.templateId && value.milestones) && Boolean(value.agreedAmount || value.templateId || value.milestones || value.vatTreatment), {
  message: 'Record an agreement or choose one billing schedule.',
});

export const financeSettingsSchema = z.object({
  automaticDraftInvoices: z.boolean(),
  defaultSalesAccountCode: z.string().trim().max(20).nullable().optional(),
  defaultTaxType: z.string().trim().max(40).nullable().optional(),
  defaultInvoiceDueDays: z.number().int().min(0).max(365).nullable().optional(),
}).strict();

export const projectFeeMilestoneUpdateSchema = z.object({
  revision: z.coerce.number().int().nonnegative().optional(),
  amount: amountSchema.optional(),
  invoiceDescription: z.string().trim().min(1).max(1000).optional(),
  enabled: z.union([z.boolean(), z.enum(['true', 'false'])]).transform((value) => value === true || value === 'true').optional(),
  waive: z.union([z.boolean(), z.enum(['true', 'false'])]).transform((value) => value === true || value === 'true').optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'Choose a milestone change.' });
