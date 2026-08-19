import {
  ActionItemKind,
  ActionItemPriority,
  ActionItemStatus,
  LifecycleActorType,
  ProjectActivityEventType,
  ProjectActivityVisibility,
  type PrismaClient,
} from '@prisma/client';

export const reconcileXeroFinanceAttention = async (database: PrismaClient, organisationId: string) => {
  const links = await database.xeroProjectInvoiceLink.findMany({
    where: { organisationId },
    include: { invoice: true },
  });
  const now = new Date();
  for (const link of links) {
    const invoice = link.invoice;
    const reviewKey = `xero:invoice:${invoice.xeroInvoiceId}:review`;
    const overdueKey = `xero:invoice:${invoice.xeroInvoiceId}:overdue`;
    if (invoice.status === 'PAID') {
      await database.actionItem.updateMany({
        where: { organisationId, dedupeKey: { in: [reviewKey, overdueKey] }, status: ActionItemStatus.OPEN },
        data: { status: ActionItemStatus.RESOLVED, resolvedAt: now },
      });
      await database.projectActivity.upsert({
        where: { organisationId_idempotencyKey: { organisationId, idempotencyKey: `xero:invoice:${invoice.xeroInvoiceId}:paid` } },
        update: {},
        create: {
          organisationId,
          projectId: link.projectId,
          eventType: ProjectActivityEventType.INVOICE_PAID,
          summary: `Invoice paid — ${invoice.currency} ${invoice.amountPaid.toFixed(2)}`,
          actorType: LifecycleActorType.SYSTEM,
          sourceType: 'XERO_INVOICE',
          sourceId: invoice.xeroInvoiceId,
          visibility: ProjectActivityVisibility.FINANCE,
          occurredAt: invoice.xeroUpdatedAt ?? now,
          idempotencyKey: `xero:invoice:${invoice.xeroInvoiceId}:paid`,
        },
      });
      continue;
    }
    if (invoice.status !== 'DRAFT') {
      await database.actionItem.updateMany({
        where: { organisationId, dedupeKey: reviewKey, status: ActionItemStatus.OPEN },
        data: { status: ActionItemStatus.RESOLVED, resolvedAt: now },
      });
    }
    const overdue = invoice.status === 'AUTHORISED' && invoice.dueDate && invoice.dueDate < now && invoice.amountDue.greaterThan(0);
    if (overdue) {
      await database.actionItem.upsert({
        where: { organisationId_dedupeKey: { organisationId, dedupeKey: overdueKey } },
        update: { status: ActionItemStatus.OPEN, resolvedAt: null, dueAt: invoice.dueDate },
        create: {
          organisationId,
          projectId: link.projectId,
          kind: ActionItemKind.XERO_INVOICE,
          title: `Xero invoice ${invoice.invoiceNumber ?? ''} is overdue`.replace('  ', ' '),
          summary: `${invoice.currency} ${invoice.amountDue.toFixed(2)} remains outstanding.`,
          actionUrl: `/projects/${link.projectId}#fees`,
          priority: ActionItemPriority.HIGH,
          dueAt: invoice.dueDate,
          dedupeKey: overdueKey,
        },
      });
    } else {
      await database.actionItem.updateMany({
        where: { organisationId, dedupeKey: overdueKey, status: ActionItemStatus.OPEN },
        data: { status: ActionItemStatus.RESOLVED, resolvedAt: now },
      });
    }
  }
};
