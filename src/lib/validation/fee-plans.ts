import { LifecycleEventType } from '@prisma/client';
import { z } from 'zod';

const amountSchema = z.union([z.string(), z.number()]).transform((value, context) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Milestone amount must be greater than zero.' });
    return z.NEVER;
  }
  return amount.toFixed(2);
});

export const feeMilestoneSchema = z.object({
  milestoneKey: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/),
  label: z.string().trim().min(1).max(160),
  triggerEventType: z.nativeEnum(LifecycleEventType).nullable(),
  amount: amountSchema,
  invoiceDescription: z.string().trim().min(1).max(1000),
  enabled: z.boolean().default(true),
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
    if (keys.has(milestone.milestoneKey)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['milestones', index, 'milestoneKey'], message: 'Milestone keys must be unique.' });
    keys.add(milestone.milestoneKey);
  });
});

export const projectFeePlanSchema = z.object({
  templateId: z.string().cuid().optional(),
  name: z.string().trim().min(1).max(160).optional(),
  currency: z.string().trim().toUpperCase().length(3).optional(),
  milestones: z.array(feeMilestoneSchema).min(1).max(30).optional(),
}).strict().refine((value) => Boolean(value.templateId) !== Boolean(value.milestones), {
  message: 'Choose either a template or provide project milestones.',
});

export const financeSettingsSchema = z.object({
  automaticDraftInvoices: z.boolean(),
  defaultSalesAccountCode: z.string().trim().max(20).nullable().optional(),
  defaultTaxType: z.string().trim().max(40).nullable().optional(),
  defaultInvoiceDueDays: z.number().int().min(0).max(365).nullable().optional(),
}).strict();

export const projectFeeMilestoneUpdateSchema = z.object({
  amount: amountSchema.optional(),
  invoiceDescription: z.string().trim().min(1).max(1000).optional(),
  enabled: z.union([z.boolean(), z.enum(['true', 'false'])]).transform((value) => value === true || value === 'true').optional(),
  waive: z.union([z.boolean(), z.enum(['true', 'false'])]).transform((value) => value === true || value === 'true').optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'Choose a milestone change.' });
