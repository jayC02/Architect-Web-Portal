import { ProjectFeeMilestoneState, type Prisma, type PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import type { feePlanTemplateSchema, projectFeePlanSchema } from '@/lib/validation/fee-plans';
import { HttpError } from '@/lib/utils/http';

type TemplateInput = z.infer<typeof feePlanTemplateSchema>;
type ProjectPlanInput = z.infer<typeof projectFeePlanSchema>;

const milestoneData = (milestones: TemplateInput['milestones'], currency?: string) => milestones.map((milestone, sortOrder) => ({
  milestoneKey: milestone.milestoneKey,
  label: milestone.label,
  triggerEventType: milestone.triggerEventType,
  amount: milestone.amount,
  ...(currency ? { currency } : {}),
  invoiceDescription: milestone.invoiceDescription,
  enabled: milestone.enabled,
  sortOrder,
  accountCode: milestone.accountCode || null,
  taxType: milestone.taxType || null,
  dueDays: milestone.dueDays ?? null,
}));

export const createFeePlanTemplate = async (
  database: PrismaClient,
  organisationId: string,
  userId: string,
  input: TemplateInput,
) => {
  const latest = await database.feePlanTemplate.findFirst({
    where: { organisationId, name: input.name },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return database.feePlanTemplate.create({
    data: {
      organisationId,
      createdByUserId: userId,
      name: input.name,
      currency: input.currency,
      version: (latest?.version ?? 0) + 1,
      milestones: { create: milestoneData(input.milestones) },
    },
    include: { milestones: { orderBy: { sortOrder: 'asc' } } },
  });
};

export const assignProjectFeePlan = async (
  tx: Prisma.TransactionClient,
  organisationId: string,
  projectId: string,
  userId: string,
  input: ProjectPlanInput,
) => {
  const project = await tx.project.findFirst({ where: { id: projectId, organisationId }, select: { id: true } });
  if (!project) throw new HttpError(404, 'Project not found.');
  const existing = await tx.projectFeePlan.findUnique({
    where: { projectId },
    include: { milestones: { select: { state: true, writeAttempt: { select: { id: true } } } } },
  });
  if (existing?.milestones.some((milestone) => milestone.writeAttempt || milestone.state === ProjectFeeMilestoneState.DRAFT_CREATED || milestone.state === ProjectFeeMilestoneState.DRAFT_CREATING)) {
    throw new HttpError(409, 'This fee plan has begun a Xero write and can no longer be replaced.');
  }

  let name = input.name ?? 'Project fee plan';
  let currency = input.currency ?? 'GBP';
  let templateId: string | null = null;
  let templateVersion: number | null = null;
  let milestones = input.milestones;
  if (input.templateId) {
    const template = await tx.feePlanTemplate.findFirst({
      where: { id: input.templateId, organisationId, active: true },
      include: { milestones: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) throw new HttpError(404, 'Fee plan template not found.');
    name = template.name;
    currency = template.currency;
    templateId = template.id;
    templateVersion = template.version;
    milestones = template.milestones.map((milestone) => ({
      milestoneKey: milestone.milestoneKey,
      label: milestone.label,
      triggerEventType: milestone.triggerEventType,
      amount: milestone.amount.toFixed(2),
      invoiceDescription: milestone.invoiceDescription,
      enabled: milestone.enabled,
      accountCode: milestone.accountCode,
      taxType: milestone.taxType,
      dueDays: milestone.dueDays,
    }));
  }
  if (!milestones) throw new HttpError(400, 'Fee plan milestones are required.');
  if (existing) await tx.projectFeePlan.delete({ where: { id: existing.id } });
  return tx.projectFeePlan.create({
    data: {
      organisationId,
      projectId,
      createdByUserId: userId,
      templateId,
      templateVersion,
      name,
      currency,
      milestones: { create: milestoneData(milestones).map((milestone) => ({
        ...milestone,
        currency,
        organisation: { connect: { id: organisationId } },
      })) },
    },
    include: { milestones: { orderBy: { sortOrder: 'asc' } } },
  });
};
