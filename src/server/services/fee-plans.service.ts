import { databaseTable } from '@/lib/db/table';
import { ProjectFeeMilestoneState, Prisma, type PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import type { feePlanTemplateSchema, projectFeePlanSchema } from '@/lib/validation/fee-plans';
import { allocatePercentages, scheduleReconciles } from '@/lib/fees/agreement';
import { HttpError } from '@/lib/utils/http';

type TemplateInput = z.infer<typeof feePlanTemplateSchema>;
type ProjectPlanInput = z.infer<typeof projectFeePlanSchema>;
const milestoneData = (milestones: TemplateInput['milestones']) => milestones.map((milestone, sortOrder) => ({
  milestoneKey: milestone.milestoneKey, label: milestone.label, triggerEventType: milestone.triggerEventType,
  amount: milestone.amount, invoiceDescription: milestone.invoiceDescription, enabled: milestone.enabled, sortOrder,
  accountCode: milestone.accountCode || null, taxType: milestone.taxType || null, dueDays: milestone.dueDays ?? null,
}));
export const createFeePlanTemplate = async (database: PrismaClient, organisationId: string, userId: string, input: TemplateInput) => {
  const latest = await database.feePlanTemplate.findFirst({ where: { organisationId, name: input.name }, orderBy: { version: 'desc' }, select: { version: true } });
  return database.feePlanTemplate.create({ data: { organisationId, createdByUserId: userId, name: input.name, currency: input.currency, version: (latest?.version ?? 0) + 1, milestones: { create: milestoneData(input.milestones) } }, include: { milestones: { orderBy: { sortOrder: 'asc' } } } });
};
export const assignProjectFeePlan = async (tx: Prisma.TransactionClient, organisationId: string, projectId: string, userId: string, input: ProjectPlanInput) => {
  const project = await tx.project.findFirst({ where: { id: projectId, organisationId }, select: { id: true } });
  if (!project) throw new HttpError(404, 'Project not found.');
  await tx.$queryRaw`SELECT id FROM ${databaseTable('Project')} WHERE id = ${projectId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT m.id FROM ${databaseTable('ProjectFeeMilestone')} m JOIN ${databaseTable('ProjectFeePlan')} p ON p.id = m."projectFeePlanId" WHERE p."projectId" = ${projectId} FOR UPDATE OF m`;
  const existing = await tx.projectFeePlan.findUnique({ where: { projectId }, include: { milestones: { include: { writeAttempt: { select: { id: true } } }, orderBy: { sortOrder: 'asc' } } } });
  if (existing && input.revision !== undefined && input.revision !== existing.revision) throw new HttpError(409, 'The project fee changed in another session. Reload before saving; your values are kept.');
  let name = input.name ?? existing?.name ?? 'Project fee';
  let currency = input.currency ?? existing?.currency ?? 'GBP';
  let templateId = existing?.templateId ?? null;
  let templateVersion = existing?.templateVersion ?? null;
  let milestones = input.milestones;
  if (input.templateId) {
    const template = await tx.feePlanTemplate.findFirst({ where: { id: input.templateId, organisationId, active: true }, include: { milestones: { orderBy: { sortOrder: 'asc' } } } });
    if (!template) throw new HttpError(404, 'Fee plan template not found.');
    name = template.name; currency = input.currency ?? template.currency; templateId = template.id; templateVersion = template.version;
    milestones = template.milestones.map(row => ({ ...row, amount: row.amount.toFixed(2), percentage: undefined }));
  }
  const agreedAmount = input.agreedAmount ?? existing?.agreedAmount?.toFixed(2) ?? null;
  const vatTreatment = input.vatTreatment ?? existing?.vatTreatment ?? 'LEGACY_UNKNOWN';
  const vatRate = vatTreatment === 'STANDARD' ? input.vatRate ?? existing?.vatRate?.toFixed(2) ?? null : null;
  if (input.agreedAmount && !existing && !input.vatTreatment) throw new HttpError(400, 'Choose VAT treatment for this agreement.');
  if (vatTreatment === 'STANDARD' && vatRate === null) throw new HttpError(400, 'Enter the VAT rate for a standard-rated fee.');
  if (existing?.milestones.some(row => row.writeAttempt) && currency !== existing.currency) throw new HttpError(409, 'Keep the currency of milestones with Xero history.');
  if (milestones) {
    if (new Set(milestones.map(row => row.milestoneKey)).size !== milestones.length) throw new HttpError(400, 'Milestone keys must be unique.');
    if (milestones.some(row => row.percentage !== undefined)) {
      const active = milestones.filter(row => row.enabled);
      if (!agreedAmount || active.some(row => row.percentage === undefined)) throw new HttpError(400, 'Percentage schedules require an agreed fee and percentages for every active row.');
      let allocated: string[];
      try { allocated = allocatePercentages(agreedAmount, active.map(row => row.percentage!)); }
      catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Invalid percentage schedule.'); }
      let activeIndex = 0;
      milestones = milestones.map(row => row.enabled ? { ...row, amount: allocated[activeIndex++] } : { ...row, percentage: undefined });
    }
    if (agreedAmount && !scheduleReconciles(agreedAmount, milestones)) throw new HttpError(400, 'Active milestones must reconcile to the agreed net fee.');
  }
  const snapshot = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  const plan = existing ? await tx.projectFeePlan.update({ where: { id: existing.id }, data: { name, currency, templateId, templateVersion, agreedAmount, vatTreatment, vatRate, notes: input.notes, revision: { increment: 1 } } }) : await tx.projectFeePlan.create({ data: { organisationId, projectId, createdByUserId: userId, name, currency, templateId, templateVersion, agreedAmount, vatTreatment, vatRate, notes: input.notes, revision: 1 } });
  if (milestones) {
    const next = milestoneData(milestones);
    for (const [index, row] of next.entries()) {
      const old = existing?.milestones.find(previous => previous.milestoneKey === row.milestoneKey);
      const protectedRow = old && (old.writeAttempt || ['DRAFT_CREATING', 'DRAFT_CREATED'].includes(old.state));
      if (protectedRow) {
        if (!old.amount.equals(row.amount) || old.enabled !== row.enabled || old.invoiceDescription !== row.invoiceDescription || old.accountCode !== row.accountCode || old.taxType !== row.taxType || old.currency !== currency || old.triggerEventType !== row.triggerEventType) throw new HttpError(409, 'A milestone with Xero history cannot be changed. Keep it and add a new milestone.');
        continue;
      }
      const schedule = { scheduleBasis: milestones[index].percentage === undefined ? 'FIXED' : 'PERCENTAGE', percentage: milestones[index].percentage === undefined ? null : new Prisma.Decimal(milestones[index].percentage!), currency };
      if (old) await tx.projectFeeMilestone.update({ where: { id: old.id }, data: { ...row, ...schedule } });
      else await tx.projectFeeMilestone.create({ data: { ...row, ...schedule, organisationId, projectFeePlanId: plan.id } });
    }
    for (const old of existing?.milestones ?? []) {
      if (next.some(row => row.milestoneKey === old.milestoneKey)) continue;
      if (old.writeAttempt || ['DRAFT_CREATING', 'DRAFT_CREATED'].includes(old.state)) throw new HttpError(409, 'Keep milestones with Xero history in the schedule.');
      await tx.projectFeeMilestone.update({ where: { id: old.id }, data: { enabled: false, state: ProjectFeeMilestoneState.WAIVED } });
    }
  }
  const updated = await tx.projectFeePlan.findUniqueOrThrow({ where: { id: plan.id }, include: { milestones: { orderBy: { sortOrder: 'asc' } } } });
  await tx.projectFeeRevision.create({ data: { projectFeePlanId: plan.id, revision: plan.revision, changedByUserId: userId, before: existing ? snapshot(existing) : Prisma.JsonNull, after: snapshot(updated) } });
  return updated;
};
