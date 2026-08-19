import crypto from 'node:crypto';
import {
  ActionItemKind,
  ActionItemPriority,
  ActionItemStatus,
  LifecycleActorType,
  ProjectActivityEventType,
  ProjectActivityVisibility,
  ProjectFeeMilestoneState,
  XeroWriteAttemptStatus,
  type LifecycleEvent,
  type PrismaClient,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { hasXeroDraftInvoiceScope } from '@/lib/xero/config';
import { xeroGet, xeroPost } from '@/lib/xero/client';
import type { XeroInvoice } from '@/lib/xero/types';
import { HttpError } from '@/lib/utils/http';

const milestoneActionKey = (id: string) => `xero:milestone:${id}:draft`;
const referenceFor = (id: string) => `AP:${id}`;
export const milestoneIdempotencyKey = (id: string) => `ap-milestone-${id}`.slice(0, 128);

export const buildDraftInvoiceRequest = (input: {
  milestoneId: string;
  xeroContactId: string;
  currency: string;
  amount: string;
  description: string;
  accountCode: string;
  taxType?: string | null;
  dueDays?: number | null;
  now?: Date;
}) => {
  const now = input.now ?? new Date();
  const due = input.dueDays == null ? null : new Date(now);
  if (due) due.setUTCDate(due.getUTCDate() + input.dueDays!);
  return {
    Invoices: [{
      Type: 'ACCREC',
      Status: 'DRAFT',
      Contact: { ContactID: input.xeroContactId },
      Date: now.toISOString().slice(0, 10),
      ...(due ? { DueDate: due.toISOString().slice(0, 10) } : {}),
      CurrencyCode: input.currency,
      Reference: referenceFor(input.milestoneId),
      LineAmountTypes: 'Exclusive',
      LineItems: [{
        Description: input.description,
        Quantity: 1,
        UnitAmount: Number(input.amount),
        AccountCode: input.accountCode,
        ...(input.taxType ? { TaxType: input.taxType } : {}),
      }],
    }],
  };
};

const stableHash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const ensureDraftAction = async (
  database: PrismaClient,
  milestone: { id: string; organisationId: string; projectFeePlan: { projectId: string }; label: string },
  summary: string,
  priority: ActionItemPriority = ActionItemPriority.MEDIUM,
) => database.actionItem.upsert({
  where: { organisationId_dedupeKey: { organisationId: milestone.organisationId, dedupeKey: milestoneActionKey(milestone.id) } },
  update: { title: `Create Xero draft — ${milestone.label}`, summary, status: ActionItemStatus.OPEN, resolvedAt: null, priority },
  create: {
    organisationId: milestone.organisationId,
    projectId: milestone.projectFeePlan.projectId,
    kind: ActionItemKind.XERO_INVOICE,
    title: `Create Xero draft — ${milestone.label}`,
    summary,
    actionUrl: `/projects/${milestone.projectFeePlan.projectId}#fees`,
    priority,
    dedupeKey: milestoneActionKey(milestone.id),
  },
});

const resolveDraftAction = (database: PrismaClient, organisationId: string, milestoneId: string) =>
  database.actionItem.updateMany({
    where: { organisationId, dedupeKey: milestoneActionKey(milestoneId), status: ActionItemStatus.OPEN },
    data: { status: ActionItemStatus.RESOLVED, resolvedAt: new Date() },
  });

const loadMilestone = (database: PrismaClient, organisationId: string, milestoneId: string) =>
  database.projectFeeMilestone.findFirst({
    where: { id: milestoneId, organisationId },
    include: {
      projectFeePlan: {
        include: { project: { include: { client: { include: { xeroLink: true } } } } },
      },
      writeAttempt: true,
    },
  });

const saveDraft = async (
  database: PrismaClient,
  milestone: NonNullable<Awaited<ReturnType<typeof loadMilestone>>>,
  connectionId: string,
  invoice: XeroInvoice,
) => {
  if (!invoice.InvoiceID || !invoice.Contact?.ContactID) throw new HttpError(502, 'Xero did not return the created draft invoice.');
  const amount = milestone.amount.toFixed(2);
  const now = new Date();
  await database.$transaction(async (tx) => {
    await tx.xeroInvoiceSnapshot.upsert({
      where: { connectionId_xeroInvoiceId: { connectionId, xeroInvoiceId: invoice.InvoiceID! } },
      create: {
        organisationId: milestone.organisationId,
        connectionId,
        xeroInvoiceId: invoice.InvoiceID!,
        xeroContactId: invoice.Contact!.ContactID!,
        invoiceNumber: invoice.InvoiceNumber ?? null,
        reference: invoice.Reference ?? referenceFor(milestone.id),
        status: invoice.Status ?? 'DRAFT',
        invoiceType: 'ACCREC',
        currency: invoice.CurrencyCode ?? milestone.currency,
        invoiceDate: now,
        dueDate: invoice.DueDateString ? new Date(invoice.DueDateString) : null,
        subtotal: String(invoice.SubTotal ?? amount),
        totalTax: String(invoice.TotalTax ?? '0.00'),
        total: String(invoice.Total ?? amount),
        amountPaid: String(invoice.AmountPaid ?? '0.00'),
        amountDue: String(invoice.AmountDue ?? invoice.Total ?? amount),
        syncedAt: now,
      },
      update: { status: invoice.Status ?? 'DRAFT', invoiceNumber: invoice.InvoiceNumber ?? null, syncedAt: now },
    });
    await tx.xeroProjectInvoiceLink.upsert({
      where: { connectionId_xeroInvoiceId: { connectionId, xeroInvoiceId: invoice.InvoiceID! } },
      create: {
        organisationId: milestone.organisationId,
        connectionId,
        projectId: milestone.projectFeePlan.projectId,
        xeroInvoiceId: invoice.InvoiceID!,
        linkedByUserId: milestone.projectFeePlan.createdByUserId,
      },
      update: {},
    });
    await tx.projectFeeMilestone.update({
      where: { id: milestone.id },
      data: { state: ProjectFeeMilestoneState.DRAFT_CREATED, linkedXeroInvoiceId: invoice.InvoiceID!, draftCreatedAt: now, lastError: null },
    });
    await tx.xeroWriteAttempt.update({
      where: { milestoneId: milestone.id },
      data: { status: XeroWriteAttemptStatus.SUCCEEDED, providerId: invoice.InvoiceID!, lastError: null, retryAt: null },
    });
    await tx.projectActivity.upsert({
      where: { organisationId_idempotencyKey: { organisationId: milestone.organisationId, idempotencyKey: `xero:milestone:${milestone.id}:draft-created` } },
      update: {},
      create: {
        organisationId: milestone.organisationId,
        projectId: milestone.projectFeePlan.projectId,
        eventType: ProjectActivityEventType.XERO_DRAFT_CREATED,
        summary: `Xero draft invoice created — ${milestone.label}`,
        actorType: LifecycleActorType.SYSTEM,
        sourceType: 'XERO_MILESTONE',
        sourceId: milestone.id,
        visibility: ProjectActivityVisibility.FINANCE,
        occurredAt: now,
        idempotencyKey: `xero:milestone:${milestone.id}:draft-created`,
      },
    });
  });
  await resolveDraftAction(database, milestone.organisationId, milestone.id);
  await database.actionItem.upsert({
    where: { organisationId_dedupeKey: { organisationId: milestone.organisationId, dedupeKey: `xero:invoice:${invoice.InvoiceID}:review` } },
    update: {},
    create: {
      organisationId: milestone.organisationId,
      projectId: milestone.projectFeePlan.projectId,
      kind: ActionItemKind.XERO_INVOICE,
      title: `Review Xero draft — ${milestone.label}`,
      summary: 'The draft is safely in Xero. Review, edit and approve it there when ready.',
      actionUrl: `/projects/${milestone.projectFeePlan.projectId}#fees`,
      priority: ActionItemPriority.MEDIUM,
      dedupeKey: `xero:invoice:${invoice.InvoiceID}:review`,
    },
  });
  return invoice;
};

const findExistingByReference = async (connection: Parameters<typeof xeroGet>[0], milestoneId: string) => {
  const where = encodeURIComponent(`Reference==\"${referenceFor(milestoneId)}\"`);
  const result = await xeroGet<{ Invoices?: XeroInvoice[] }>(connection, `/Invoices?where=${where}`);
  return result.Invoices?.find((invoice) => invoice.Reference === referenceFor(milestoneId));
};

export const createXeroDraftForMilestone = async (
  organisationId: string,
  milestoneId: string,
  options: { database?: PrismaClient; post?: typeof xeroPost; lookup?: typeof findExistingByReference } = {},
) => {
  const database = options.database ?? prisma;
  const milestone = await loadMilestone(database, organisationId, milestoneId);
  if (!milestone) throw new HttpError(404, 'Fee milestone not found.');
  if (milestone.state === ProjectFeeMilestoneState.DRAFT_CREATED) return { alreadyCreated: true, invoiceId: milestone.linkedXeroInvoiceId };
  if (milestone.state !== ProjectFeeMilestoneState.ELIGIBLE && milestone.state !== ProjectFeeMilestoneState.FAILED) {
    throw new HttpError(409, 'This fee milestone is not eligible for invoicing.');
  }
  const connection = await database.xeroConnection.findUnique({ where: { organisationId } });
  const settings = await database.organisationFinanceSettings.findUnique({ where: { organisationId } });
  const clientLink = milestone.projectFeePlan.project.client?.xeroLink;
  const accountCode = milestone.accountCode || settings?.defaultSalesAccountCode;
  if (!connection) {
    await ensureDraftAction(database, milestone, 'Connect Xero before creating this draft.', ActionItemPriority.HIGH);
    throw new HttpError(409, 'Connect Xero before creating a draft invoice.');
  }
  if (connection.status === 'RECONNECT_REQUIRED' || connection.status === 'DISCONNECTED') {
    await ensureDraftAction(database, milestone, 'Reconnect Xero before creating this draft.', ActionItemPriority.HIGH);
    throw new HttpError(409, 'Reconnect Xero before creating a draft invoice.');
  }
  if (!hasXeroDraftInvoiceScope(connection.grantedScopes)) {
    await ensureDraftAction(database, milestone, 'Allow Xero draft-invoice permission in Settings before continuing.', ActionItemPriority.HIGH);
    throw new HttpError(409, 'Xero draft-invoice permission is required.');
  }
  if (!clientLink || clientLink.connectionId !== connection.id) {
    await ensureDraftAction(database, milestone, 'Link this project client to the exact Xero contact before continuing.', ActionItemPriority.HIGH);
    throw new HttpError(409, 'Link the project client to a Xero contact before creating a draft invoice.');
  }
  if (!accountCode) {
    await ensureDraftAction(database, milestone, 'Choose a Xero sales account code before continuing.', ActionItemPriority.HIGH);
    throw new HttpError(409, 'A Xero sales account code is required.');
  }
  const request = buildDraftInvoiceRequest({
    milestoneId: milestone.id,
    xeroContactId: clientLink.xeroContactId,
    currency: milestone.currency,
    amount: milestone.amount.toFixed(2),
    description: milestone.invoiceDescription,
    accountCode,
    taxType: milestone.taxType || settings?.defaultTaxType,
    dueDays: milestone.dueDays ?? settings?.defaultInvoiceDueDays,
  });
  const idempotencyKey = milestoneIdempotencyKey(milestone.id);
  const requestHash = stableHash(request);
  const existingAttempt = milestone.writeAttempt;
  if (existingAttempt && existingAttempt.requestHash !== requestHash) throw new HttpError(409, 'The milestone changed after draft creation began. Review it before retrying.');

  if (existingAttempt?.status === XeroWriteAttemptStatus.UNCERTAIN) {
    try {
      const reconciled = await (options.lookup ?? findExistingByReference)(connection, milestone.id);
      if (reconciled) return { alreadyCreated: true, invoice: await saveDraft(database, milestone, connection.id, reconciled) };
    } catch {
      // Continue with the same provider idempotency key; never mint a second operation.
    }
  }
  const claimed = await database.$transaction(async (tx) => {
    const current = await tx.projectFeeMilestone.updateMany({
      where: { id: milestone.id, organisationId, state: { in: [ProjectFeeMilestoneState.ELIGIBLE, ProjectFeeMilestoneState.FAILED] } },
      data: { state: ProjectFeeMilestoneState.DRAFT_CREATING, lastError: null },
    });
    if (current.count !== 1) return false;
    await tx.xeroWriteAttempt.upsert({
      where: { milestoneId: milestone.id },
      create: { organisationId, connectionId: connection.id, milestoneId: milestone.id, operation: 'CREATE_DRAFT_INVOICE', idempotencyKey, requestHash, status: XeroWriteAttemptStatus.PROCESSING, attempts: 1 },
      update: { status: XeroWriteAttemptStatus.PROCESSING, attempts: { increment: 1 }, lastError: null, retryAt: null },
    });
    return true;
  });
  if (!claimed) throw new HttpError(409, 'Draft creation is already in progress.');
  try {
    const response = await (options.post ?? xeroPost)<{ Invoices?: XeroInvoice[] }>(connection, '/Invoices', request, { 'Idempotency-Key': idempotencyKey });
    const invoice = response.Invoices?.[0];
    if (!invoice) throw new HttpError(502, 'Xero did not return a draft invoice.');
    return { alreadyCreated: false, invoice: await saveDraft(database, milestone, connection.id, invoice) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Xero draft creation did not complete.';
    await database.$transaction([
      database.projectFeeMilestone.update({ where: { id: milestone.id }, data: { state: ProjectFeeMilestoneState.ELIGIBLE, lastError: message.slice(0, 1000) } }),
      database.xeroWriteAttempt.update({ where: { milestoneId: milestone.id }, data: { status: XeroWriteAttemptStatus.UNCERTAIN, lastError: message.slice(0, 1000), retryAt: new Date(Date.now() + 60_000) } }),
    ]);
    await ensureDraftAction(database, milestone, 'Xero did not confirm the draft. Retry safely; Architect Pro will reconcile using the same operation key.', ActionItemPriority.HIGH);
    throw error;
  }
};

export const makeFeeMilestonesEligible = async (database: PrismaClient, event: LifecycleEvent) => {
  const milestones = await database.projectFeeMilestone.findMany({
    where: {
      organisationId: event.organisationId,
      projectFeePlan: { projectId: event.projectId, active: true },
      triggerEventType: event.eventType,
      enabled: true,
      state: ProjectFeeMilestoneState.PENDING,
    },
    include: { projectFeePlan: true },
  });
  const settings = await database.organisationFinanceSettings.findUnique({ where: { organisationId: event.organisationId } });
  for (const milestone of milestones) {
    await database.projectFeeMilestone.updateMany({
      where: { id: milestone.id, state: ProjectFeeMilestoneState.PENDING },
      data: { state: ProjectFeeMilestoneState.ELIGIBLE, eligibleAt: event.occurredAt, sourceLifecycleEventId: event.id },
    });
    await ensureDraftAction(database, milestone, settings?.automaticDraftInvoices
      ? 'This fee milestone is eligible. Architect Pro will create a Xero DRAFT when all prerequisites are available.'
      : 'This fee milestone is eligible. Review it and create a Xero DRAFT when ready.');
    if (settings?.automaticDraftInvoices) {
      await createXeroDraftForMilestone(event.organisationId, milestone.id, { database }).catch(() => undefined);
    }
  }
  return milestones.length;
};
