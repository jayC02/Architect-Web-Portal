import { Prisma } from '@prisma/client';

type DecimalInput = Prisma.Decimal | string | number;
export type InvoiceMetricInput = {
  xeroInvoiceId?: string;
  xeroContactId?: string;
  invoiceType: string;
  status: string;
  currency: string;
  invoiceDate: Date | null;
  dueDate: Date | null;
  total: DecimalInput;
  amountPaid: DecimalInput;
  amountDue: DecimalInput;
};
export type PaymentMetricInput = {
  status: string | null;
  currency: string;
  paymentDate: Date | null;
  amount: DecimalInput;
};

const ZERO = new Prisma.Decimal(0);
const includedInvoiceStatuses = new Set(['AUTHORISED', 'PAID']);
const includedPaymentStatuses = new Set(['AUTHORISED']);
const toDecimal = (value: DecimalInput) => new Prisma.Decimal(value);
const startOfUtcMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const startOfUtcYear = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
const startOfUtcDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const inRange = (value: Date | null, start: Date, end: Date) => Boolean(value && value >= start && value < end);
const addCurrency = (totals: Map<string, Prisma.Decimal>, currency: string, value: DecimalInput) => {
  totals.set(currency, (totals.get(currency) ?? ZERO).plus(toDecimal(value)));
};
const serialise = (totals: Map<string, Prisma.Decimal>) => Object.fromEntries(
  [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currency, value]) => [currency, value.toFixed(2)]),
);

export const isIncludedSalesInvoice = (invoice: InvoiceMetricInput) =>
  invoice.invoiceType === 'ACCREC' && includedInvoiceStatuses.has(invoice.status);

export const calculateFinanceMetrics = (
  invoices: InvoiceMetricInput[],
  payments: PaymentMetricInput[],
  now = new Date(),
) => {
  const monthStart = startOfUtcMonth(now);
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const today = startOfUtcDay(now);
  const invoiced = new Map<string, Prisma.Decimal>();
  const paid = new Map<string, Prisma.Decimal>();
  const outstanding = new Map<string, Prisma.Decimal>();
  const overdue = new Map<string, Prisma.Decimal>();

  for (const invoice of invoices) {
    if (!isIncludedSalesInvoice(invoice)) continue;
    if (inRange(invoice.invoiceDate, monthStart, nextMonth)) addCurrency(invoiced, invoice.currency, invoice.total);
    if (toDecimal(invoice.amountDue).greaterThan(0)) {
      addCurrency(outstanding, invoice.currency, invoice.amountDue);
      if (invoice.dueDate && invoice.dueDate < today) addCurrency(overdue, invoice.currency, invoice.amountDue);
    }
  }
  for (const payment of payments) {
    if (!payment.paymentDate || !includedPaymentStatuses.has(payment.status ?? '')) continue;
    if (inRange(payment.paymentDate, monthStart, nextMonth)) addCurrency(paid, payment.currency, payment.amount);
  }
  return {
    period: { monthStart, monthEnd: nextMonth, yearStart: startOfUtcYear(now), asOf: now },
    invoicedThisMonth: serialise(invoiced),
    paidThisMonth: serialise(paid),
    outstanding: serialise(outstanding),
    overdue: serialise(overdue),
  };
};

export const calculateMonthlySeries = (
  invoices: InvoiceMetricInput[],
  payments: PaymentMetricInput[],
  now = new Date(),
) => Array.from({ length: 12 }, (_, index) => {
  const offset = 11 - index;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const invoiced = new Map<string, Prisma.Decimal>();
  const paid = new Map<string, Prisma.Decimal>();
  invoices.filter(isIncludedSalesInvoice).forEach((invoice) => {
    if (inRange(invoice.invoiceDate, start, end)) addCurrency(invoiced, invoice.currency, invoice.total);
  });
  payments.forEach((payment) => {
    if (includedPaymentStatuses.has(payment.status ?? '') && inRange(payment.paymentDate, start, end)) {
      addCurrency(paid, payment.currency, payment.amount);
    }
  });
  return { month: start.toISOString().slice(0, 7), invoiced: serialise(invoiced), paid: serialise(paid) };
});

export const normaliseMatchValue = (value: string | null | undefined) =>
  (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
