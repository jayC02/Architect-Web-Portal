import { Prisma, XeroReportType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { calculateFinanceMetrics, calculateMonthlySeries, isIncludedSalesInvoice } from '@/lib/xero/metrics';
import { xeroInvoiceDeepLink } from '@/lib/xero/mapping';

export const loadFinanceDashboard = async (organisationId: string, now = new Date()) => {
  const connection = await prisma.xeroConnection.findUnique({
    where: { organisationId },
    select: {
      id: true,
      xeroTenantName: true,
      xeroShortCode: true,
      baseCurrency: true,
      status: true,
      lastSyncedAt: true,
      lastSyncError: true,
    },
  });
  if (!connection) return null;
  const [invoices, payments, profitAndLoss, contacts, clientLinks, projectLinks, aged] = await Promise.all([
    prisma.xeroInvoiceSnapshot.findMany({
      where: { organisationId },
      select: {
        xeroInvoiceId: true,
        xeroContactId: true,
        invoiceNumber: true,
        reference: true,
        invoiceType: true,
        status: true,
        currency: true,
        invoiceDate: true,
        dueDate: true,
        total: true,
        amountPaid: true,
        amountDue: true,
      },
    }),
    prisma.xeroPaymentSnapshot.findMany({
      where: { organisationId, paymentDate: { gte: new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1)) } },
      select: { status: true, currency: true, paymentDate: true, amount: true },
    }),
    prisma.xeroReportSnapshot.findFirst({
      where: { organisationId, reportType: XeroReportType.PROFIT_AND_LOSS },
      orderBy: { periodEnd: 'desc' },
      select: { periodStart: true, periodEnd: true, currency: true, revenue: true, netProfit: true, syncedAt: true },
    }),
    prisma.xeroContactSnapshot.findMany({ where: { organisationId }, select: { xeroContactId: true, name: true } }),
    prisma.xeroClientLink.findMany({
      where: { organisationId },
      select: { xeroContactId: true, client: { select: { id: true, name: true } } },
    }),
    prisma.xeroProjectInvoiceLink.findMany({
      where: { organisationId },
      select: { xeroInvoiceId: true, project: { select: { id: true, name: true } } },
    }),
    prisma.xeroAgedReceivableSnapshot.findMany({
      where: { organisationId },
      select: { currentAmount: true, days1To30: true, days31To60: true, days61To90: true, days91Plus: true },
    }),
  ]);

  const metrics = calculateFinanceMetrics(invoices, payments, now);
  const monthly = calculateMonthlySeries(invoices, payments, now);
  const contactNames = new Map(contacts.map((contact) => [contact.xeroContactId, contact.name]));
  const clients = new Map(clientLinks.map((link) => [link.xeroContactId, link.client]));
  const projects = new Map(projectLinks.map((link) => [link.xeroInvoiceId, link.project]));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const debtors = invoices
    .filter((invoice) => isIncludedSalesInvoice(invoice) && invoice.amountDue.greaterThan(0))
    .map((invoice) => ({
      ...invoice,
      total: invoice.total.toFixed(2),
      amountPaid: invoice.amountPaid.toFixed(2),
      amountDue: invoice.amountDue.toFixed(2),
      contactName: contactNames.get(invoice.xeroContactId) ?? 'Unknown Xero contact',
      client: clients.get(invoice.xeroContactId) ?? null,
      project: projects.get(invoice.xeroInvoiceId) ?? null,
      daysOverdue: invoice.dueDate && invoice.dueDate < today
        ? Math.max(0, Math.floor((today.getTime() - invoice.dueDate.getTime()) / 86_400_000))
        : 0,
      xeroUrl: xeroInvoiceDeepLink(connection.xeroShortCode, invoice.xeroInvoiceId),
    }))
    .sort((left, right) => right.daysOverdue - left.daysOverdue || Number(right.amountDue) - Number(left.amountDue));

  const topClientTotals = new Map<string, { name: string; currency: string; value: Prisma.Decimal }>();
  invoices.filter(isIncludedSalesInvoice).forEach((invoice) => {
    const key = `${invoice.currency}:${invoice.xeroContactId}`;
    const current = topClientTotals.get(key);
    topClientTotals.set(key, {
      name: contactNames.get(invoice.xeroContactId) ?? 'Unknown Xero contact',
      currency: invoice.currency,
      value: (current?.value ?? new Prisma.Decimal(0)).plus(invoice.total),
    });
  });
  const topClients = [...topClientTotals.values()]
    .sort((left, right) => right.value.comparedTo(left.value))
    .slice(0, 8)
    .map((item) => ({ name: item.name, currency: item.currency, value: item.value.toFixed(2) }));

  const ageTotals = aged.reduce((totals, row) => ({
    current: totals.current.plus(row.currentAmount),
    days1To30: totals.days1To30.plus(row.days1To30),
    days31To60: totals.days31To60.plus(row.days31To60),
    days61To90: totals.days61To90.plus(row.days61To90),
    days91Plus: totals.days91Plus.plus(row.days91Plus),
  }), {
    current: new Prisma.Decimal(0), days1To30: new Prisma.Decimal(0), days31To60: new Prisma.Decimal(0),
    days61To90: new Prisma.Decimal(0), days91Plus: new Prisma.Decimal(0),
  });

  return {
    connection,
    metrics,
    monthly,
    profitAndLoss: profitAndLoss ? {
      ...profitAndLoss,
      revenue: profitAndLoss.revenue?.toFixed(2) ?? null,
      netProfit: profitAndLoss.netProfit?.toFixed(2) ?? null,
    } : null,
    debtors,
    topClients,
    ageTotals: Object.fromEntries(Object.entries(ageTotals).map(([key, value]) => [key, value.toFixed(2)])),
  };
};
