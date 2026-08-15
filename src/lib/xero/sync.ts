import { XeroConnectionStatus, XeroReportType, type XeroConnection } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { xeroGet } from '@/lib/xero/client';
import { XeroNotConnected, XeroSyncFailed, XeroSyncInProgress } from '@/lib/xero/errors';
import {
  boundedReportSummary,
  decimalString,
  parseAgedReceivables,
  parseProfitAndLoss,
  parseXeroDate,
} from '@/lib/xero/mapping';
import type { XeroContact, XeroInvoice, XeroPayment, XeroReport } from '@/lib/xero/types';

const pageSize = 100;
const syncStaleBefore = () => new Date(Date.now() - 30 * 60 * 1000);
const ifModifiedHeaders = (value: Date | null) => value ? { 'If-Modified-Since': value.toUTCString() } : undefined;

const pagedXeroGet = async <T>(
  connection: XeroConnection,
  pathForPage: (page: number) => string,
  key: string,
  modifiedSince: Date | null,
) => {
  const records: T[] = [];
  for (let page = 1; ; page += 1) {
    const response = await xeroGet<Record<string, T[] | undefined>>(
      connection,
      pathForPage(page),
      ifModifiedHeaders(modifiedSince),
    );
    const pageRecords = response[key] ?? [];
    records.push(...pageRecords);
    if (pageRecords.length < pageSize) break;
  }
  return records;
};

const inChunks = async <T>(items: T[], action: (item: T) => Promise<unknown>) => {
  for (let index = 0; index < items.length; index += 40) {
    await Promise.all(items.slice(index, index + 40).map(action));
  }
};

const syncOrganisation = async (connection: XeroConnection) => {
  const response = await xeroGet<{ Organisations?: Array<{ Name?: string; ShortCode?: string; BaseCurrency?: string }> }>(connection, '/Organisation');
  const organisation = response.Organisations?.[0];
  if (!organisation) throw new XeroSyncFailed('Xero did not return organisation details.');
  await prisma.xeroConnection.update({
    where: { id: connection.id },
    data: {
      xeroTenantName: organisation.Name ?? connection.xeroTenantName,
      xeroShortCode: organisation.ShortCode ?? null,
      baseCurrency: organisation.BaseCurrency ?? null,
    },
  });
  return 1;
};

const syncContacts = async (connection: XeroConnection) => {
  const syncedAt = new Date();
  const contacts = await pagedXeroGet<XeroContact>(
    connection,
    (page) => `/Contacts?page=${page}&pageSize=${pageSize}&includeArchived=true`,
    'Contacts',
    connection.contactsLastSyncedAt,
  );
  await inChunks(contacts.filter((contact) => contact.ContactID && contact.Name), async (contact) => {
    await prisma.xeroContactSnapshot.upsert({
      where: { connectionId_xeroContactId: { connectionId: connection.id, xeroContactId: contact.ContactID! } },
      create: {
        organisationId: connection.organisationId,
        connectionId: connection.id,
        xeroContactId: contact.ContactID!,
        name: contact.Name!,
        firstName: contact.FirstName ?? null,
        lastName: contact.LastName ?? null,
        email: contact.EmailAddress ?? null,
        accountNumber: contact.AccountNumber ?? null,
        contactStatus: contact.ContactStatus ?? null,
        isCustomer: contact.IsCustomer ?? false,
        xeroUpdatedAt: parseXeroDate(contact.UpdatedDateUTC),
        syncedAt,
      },
      update: {
        name: contact.Name!,
        firstName: contact.FirstName ?? null,
        lastName: contact.LastName ?? null,
        email: contact.EmailAddress ?? null,
        accountNumber: contact.AccountNumber ?? null,
        contactStatus: contact.ContactStatus ?? null,
        isCustomer: contact.IsCustomer ?? false,
        xeroUpdatedAt: parseXeroDate(contact.UpdatedDateUTC),
        syncedAt,
      },
    });
  });
  await prisma.xeroConnection.update({ where: { id: connection.id }, data: { contactsLastSyncedAt: syncedAt } });
  return contacts.length;
};

const syncInvoices = async (connection: XeroConnection) => {
  const syncedAt = new Date();
  const invoices = await pagedXeroGet<XeroInvoice>(
    connection,
    (page) => `/Invoices?page=${page}&summaryOnly=true&where=${encodeURIComponent('Type=="ACCREC"')}`,
    'Invoices',
    connection.invoicesLastSyncedAt,
  );
  const valid = invoices.filter((invoice) => invoice.InvoiceID && invoice.Contact?.ContactID && invoice.Type === 'ACCREC');
  await inChunks(valid, async (invoice) => {
    await prisma.xeroInvoiceSnapshot.upsert({
      where: { connectionId_xeroInvoiceId: { connectionId: connection.id, xeroInvoiceId: invoice.InvoiceID! } },
      create: {
        organisationId: connection.organisationId,
        connectionId: connection.id,
        xeroInvoiceId: invoice.InvoiceID!,
        xeroContactId: invoice.Contact!.ContactID!,
        invoiceNumber: invoice.InvoiceNumber ?? null,
        reference: invoice.Reference ?? null,
        status: invoice.Status ?? 'UNKNOWN',
        invoiceType: invoice.Type ?? 'ACCREC',
        currency: invoice.CurrencyCode ?? connection.baseCurrency ?? 'GBP',
        invoiceDate: parseXeroDate(invoice.DateString ?? invoice.Date),
        dueDate: parseXeroDate(invoice.DueDateString ?? invoice.DueDate),
        subtotal: decimalString(invoice.SubTotal),
        totalTax: decimalString(invoice.TotalTax),
        total: decimalString(invoice.Total),
        amountPaid: decimalString(invoice.AmountPaid),
        amountDue: decimalString(invoice.AmountDue),
        xeroUpdatedAt: parseXeroDate(invoice.UpdatedDateUTC),
        syncedAt,
      },
      update: {
        xeroContactId: invoice.Contact!.ContactID!,
        invoiceNumber: invoice.InvoiceNumber ?? null,
        reference: invoice.Reference ?? null,
        status: invoice.Status ?? 'UNKNOWN',
        currency: invoice.CurrencyCode ?? connection.baseCurrency ?? 'GBP',
        invoiceDate: parseXeroDate(invoice.DateString ?? invoice.Date),
        dueDate: parseXeroDate(invoice.DueDateString ?? invoice.DueDate),
        subtotal: decimalString(invoice.SubTotal),
        totalTax: decimalString(invoice.TotalTax),
        total: decimalString(invoice.Total),
        amountPaid: decimalString(invoice.AmountPaid),
        amountDue: decimalString(invoice.AmountDue),
        xeroUpdatedAt: parseXeroDate(invoice.UpdatedDateUTC),
        syncedAt,
      },
    });
    await prisma.xeroContactSnapshot.updateMany({
      where: { connectionId: connection.id, xeroContactId: invoice.Contact!.ContactID! },
      data: { isCustomer: true },
    });
  });
  await prisma.xeroConnection.update({ where: { id: connection.id }, data: { invoicesLastSyncedAt: syncedAt } });
  return valid.length;
};

const syncPayments = async (connection: XeroConnection) => {
  const syncedAt = new Date();
  const payments = await pagedXeroGet<XeroPayment>(
    connection,
    (page) => `/Payments?page=${page}`,
    'Payments',
    connection.paymentsLastSyncedAt,
  );
  const valid = payments.filter((payment) => payment.PaymentID && !Array.isArray(payment.Invoice) && payment.Invoice?.Type === 'ACCREC');
  await inChunks(valid, async (payment) => {
    const invoiceId = !Array.isArray(payment.Invoice) ? payment.Invoice?.InvoiceID ?? null : null;
    const currency = !Array.isArray(payment.Invoice) ? payment.Invoice?.CurrencyCode ?? connection.baseCurrency ?? 'GBP' : connection.baseCurrency ?? 'GBP';
    await prisma.xeroPaymentSnapshot.upsert({
      where: { connectionId_xeroPaymentId: { connectionId: connection.id, xeroPaymentId: payment.PaymentID! } },
      create: {
        organisationId: connection.organisationId,
        connectionId: connection.id,
        xeroPaymentId: payment.PaymentID!,
        xeroInvoiceId: invoiceId,
        paymentDate: parseXeroDate(payment.Date),
        amount: decimalString(payment.Amount),
        currency,
        status: payment.Status ?? null,
        xeroUpdatedAt: parseXeroDate(payment.UpdatedDateUTC),
        syncedAt,
      },
      update: {
        xeroInvoiceId: invoiceId,
        paymentDate: parseXeroDate(payment.Date),
        amount: decimalString(payment.Amount),
        currency,
        status: payment.Status ?? null,
        xeroUpdatedAt: parseXeroDate(payment.UpdatedDateUTC),
        syncedAt,
      },
    });
  });
  await prisma.xeroConnection.update({ where: { id: connection.id }, data: { paymentsLastSyncedAt: syncedAt } });
  return valid.length;
};

const fallbackAgedBuckets = (dueDate: Date | null, amountDue: { toFixed: (places: number) => string }, now: Date) => {
  const amount = amountDue.toFixed(2);
  if (!dueDate || dueDate >= now) return { currentAmount: amount, days1To30: '0.00', days31To60: '0.00', days61To90: '0.00', days91Plus: '0.00', total: amount };
  const days = Math.floor((now.getTime() - dueDate.getTime()) / 86_400_000);
  return {
    currentAmount: '0.00',
    days1To30: days <= 30 ? amount : '0.00',
    days31To60: days > 30 && days <= 60 ? amount : '0.00',
    days61To90: days > 60 && days <= 90 ? amount : '0.00',
    days91Plus: days > 90 ? amount : '0.00',
    total: amount,
  };
};

const syncReports = async (connection: XeroConnection) => {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
  const profitResponse = await xeroGet<{ Reports?: XeroReport[] }>(
    connection,
    `/Reports/ProfitAndLoss?fromDate=${dateOnly(periodStart)}&toDate=${dateOnly(now)}`,
  );
  const profitReport = profitResponse.Reports?.[0];
  if (!profitReport) throw new XeroSyncFailed('Xero did not return the Profit & Loss report.');
  const profit = parseProfitAndLoss(profitReport);
  await prisma.xeroReportSnapshot.upsert({
    where: {
      connectionId_reportType_periodEnd: {
        connectionId: connection.id,
        reportType: XeroReportType.PROFIT_AND_LOSS,
        periodEnd: new Date(`${dateOnly(now)}T00:00:00.000Z`),
      },
    },
    create: {
      organisationId: connection.organisationId,
      connectionId: connection.id,
      reportType: XeroReportType.PROFIT_AND_LOSS,
      periodStart,
      periodEnd: new Date(`${dateOnly(now)}T00:00:00.000Z`),
      currency: connection.baseCurrency,
      revenue: profit.revenue,
      netProfit: profit.netProfit,
      summary: boundedReportSummary(profitReport),
      reportUpdatedAt: parseXeroDate(profitReport.UpdatedDateUTC),
      syncedAt: now,
    },
    update: {
      currency: connection.baseCurrency,
      revenue: profit.revenue,
      netProfit: profit.netProfit,
      summary: boundedReportSummary(profitReport),
      reportUpdatedAt: parseXeroDate(profitReport.UpdatedDateUTC),
      syncedAt: now,
    },
  });

  const outstanding = await prisma.xeroInvoiceSnapshot.findMany({
    where: { connectionId: connection.id, invoiceType: 'ACCREC', amountDue: { gt: 0 }, status: 'AUTHORISED' },
    select: { xeroContactId: true, dueDate: true, amountDue: true },
  });
  const byContact = new Map<string, typeof outstanding>();
  outstanding.forEach((invoice) => byContact.set(invoice.xeroContactId, [...(byContact.get(invoice.xeroContactId) ?? []), invoice]));
  let agedCount = 0;
  for (const [contactId, contactInvoices] of byContact) {
    const agedResponse = await xeroGet<{ Reports?: XeroReport[] }>(
      connection,
      `/Reports/AgedReceivablesByContact?contactID=${encodeURIComponent(contactId)}&date=${dateOnly(now)}`,
    );
    const report = agedResponse.Reports?.[0];
    if (!report) continue;
    const parsed = parseAgedReceivables(report);
    const fallback = contactInvoices.reduce((total, invoice) => {
      const bucket = fallbackAgedBuckets(invoice.dueDate, invoice.amountDue, now);
      return Object.fromEntries(Object.keys(total).map((key) => [key, decimalString(Number(total[key as keyof typeof total]) + Number(bucket[key as keyof typeof bucket]))])) as typeof total;
    }, { currentAmount: '0.00', days1To30: '0.00', days31To60: '0.00', days61To90: '0.00', days91Plus: '0.00', total: '0.00' });
    const values = parsed ?? fallback;
    await prisma.xeroAgedReceivableSnapshot.upsert({
      where: { connectionId_xeroContactId: { connectionId: connection.id, xeroContactId: contactId } },
      create: {
        organisationId: connection.organisationId,
        connectionId: connection.id,
        xeroContactId: contactId,
        reportDate: now,
        ...values,
        summary: boundedReportSummary(report),
        syncedAt: now,
      },
      update: { reportDate: now, ...values, summary: boundedReportSummary(report), syncedAt: now },
    });
    agedCount += 1;
  }
  await prisma.xeroConnection.update({ where: { id: connection.id }, data: { reportsLastSyncedAt: now } });
  return 1 + agedCount;
};

export const syncXeroOrganisation = async (organisationId: string) => {
  const connection = await prisma.xeroConnection.findUnique({ where: { organisationId } });
  if (!connection) throw new XeroNotConnected();
  const claimed = await prisma.xeroConnection.updateMany({
    where: {
      id: connection.id,
      OR: [
        { status: { not: XeroConnectionStatus.SYNCING } },
        { syncStartedAt: { lt: syncStaleBefore() } },
        { syncStartedAt: null },
      ],
    },
    data: { status: XeroConnectionStatus.SYNCING, syncStartedAt: new Date(), lastSyncError: null },
  });
  if (claimed.count !== 1) throw new XeroSyncInProgress();

  let current = await prisma.xeroConnection.findUniqueOrThrow({ where: { id: connection.id } });
  const results: Record<string, number> = {};
  const errors: string[] = [];
  try {
    results.organisation = await syncOrganisation(current);
    current = await prisma.xeroConnection.findUniqueOrThrow({ where: { id: connection.id } });
  } catch (error) {
    errors.push(`organisation: ${error instanceof Error ? error.message : 'sync failed'}`);
  }
  const datasets: Array<[string, () => Promise<number>]> = [
    ['contacts', () => syncContacts(current)],
    ['invoices', () => syncInvoices(current)],
    ['payments', () => syncPayments(current)],
    ['reports', () => syncReports(current)],
  ];
  for (const [name, action] of datasets) {
    try {
      results[name] = await action();
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : 'sync failed'}`);
    }
  }
  const completedAt = new Date();
  await prisma.xeroConnection.update({
    where: { id: current.id },
    data: {
      status: errors.length ? XeroConnectionStatus.ERROR : XeroConnectionStatus.CONNECTED,
      syncStartedAt: null,
      lastSyncedAt: errors.length ? connection.lastSyncedAt : completedAt,
      lastSyncError: errors.length ? errors.join('; ').slice(0, 1000) : null,
    },
  });
  if (errors.length) throw new XeroSyncFailed();
  return results;
};
