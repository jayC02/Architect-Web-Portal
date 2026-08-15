import assert from 'node:assert/strict';
import { calculateFinanceMetrics, calculateMonthlySeries, normaliseMatchValue } from '../src/lib/xero/metrics';
import { parseProfitAndLoss, parseXeroDate } from '../src/lib/xero/mapping';

const now = new Date('2026-08-15T12:00:00.000Z');
const invoices = [
  { xeroInvoiceId: 'part-paid', invoiceType: 'ACCREC', status: 'AUTHORISED', currency: 'GBP', invoiceDate: new Date('2026-08-02T00:00:00Z'), dueDate: new Date('2026-08-10T00:00:00Z'), total: '1000.00', amountPaid: '400.00', amountDue: '600.00' },
  { xeroInvoiceId: 'paid', invoiceType: 'ACCREC', status: 'PAID', currency: 'GBP', invoiceDate: new Date('2026-08-03T00:00:00Z'), dueDate: new Date('2026-08-10T00:00:00Z'), total: '500.00', amountPaid: '500.00', amountDue: '0.00' },
  { xeroInvoiceId: 'draft', invoiceType: 'ACCREC', status: 'DRAFT', currency: 'GBP', invoiceDate: new Date('2026-08-04T00:00:00Z'), dueDate: new Date('2026-08-20T00:00:00Z'), total: '300.00', amountPaid: '0.00', amountDue: '300.00' },
  { xeroInvoiceId: 'voided', invoiceType: 'ACCREC', status: 'VOIDED', currency: 'GBP', invoiceDate: new Date('2026-08-05T00:00:00Z'), dueDate: new Date('2026-08-06T00:00:00Z'), total: '200.00', amountPaid: '0.00', amountDue: '200.00' },
  { xeroInvoiceId: 'eur', invoiceType: 'ACCREC', status: 'AUTHORISED', currency: 'EUR', invoiceDate: new Date('2026-08-06T00:00:00Z'), dueDate: new Date('2026-08-25T00:00:00Z'), total: '100.00', amountPaid: '0.00', amountDue: '100.00' },
  { xeroInvoiceId: 'prior-month', invoiceType: 'ACCREC', status: 'AUTHORISED', currency: 'GBP', invoiceDate: new Date('2026-07-31T23:59:59Z'), dueDate: new Date('2026-08-30T00:00:00Z'), total: '75.00', amountPaid: '0.00', amountDue: '75.00' },
] as const;
const payments = [
  { status: 'AUTHORISED', currency: 'GBP', paymentDate: new Date('2026-08-08T00:00:00Z'), amount: '400.00' },
  { status: 'AUTHORISED', currency: 'EUR', paymentDate: new Date('2026-08-09T00:00:00Z'), amount: '50.00' },
  { status: 'DELETED', currency: 'GBP', paymentDate: new Date('2026-08-10T00:00:00Z'), amount: '999.00' },
] as const;

const metrics = calculateFinanceMetrics([...invoices], [...payments], now);
assert.deepEqual(metrics.invoicedThisMonth, { EUR: '100.00', GBP: '1500.00' }, 'currencies remain separate and draft/voided invoices are excluded');
assert.deepEqual(metrics.paidThisMonth, { EUR: '50.00', GBP: '400.00' }, 'paid this month uses authorised payments and preserves currency');
assert.deepEqual(metrics.outstanding, { EUR: '100.00', GBP: '675.00' }, 'part-paid and prior-month outstanding amounts use amount due');
assert.deepEqual(metrics.overdue, { GBP: '600.00' }, 'only the remaining overdue balance is counted');

const series = calculateMonthlySeries([...invoices], [...payments], now);
assert.equal(series.length, 12);
assert.deepEqual(series.at(-1)?.invoiced, { EUR: '100.00', GBP: '1500.00' });
assert.equal(series.at(-2)?.invoiced.GBP, '75.00', 'UTC month boundaries are respected');

assert.equal(normaliseMatchValue(' ACME & Partners, Ltd. '), 'acme partners ltd');
assert.equal(parseXeroDate('/Date(1786752000000+0000)/')?.toISOString(), '2026-08-15T00:00:00.000Z');
const profit = parseProfitAndLoss({ Rows: [{ RowType: 'Section', Rows: [
  { RowType: 'SummaryRow', Cells: [{ Value: 'Total Income' }, { Value: '12,500.25' }] },
  { RowType: 'Row', Cells: [{ Value: 'NET PROFIT' }, { Value: '3,200.10' }] },
] }] });
assert.deepEqual(profit, { revenue: '12500.25', netProfit: '3200.10' }, 'P&L values remain distinct from invoice metrics');

console.log('xero metric tests passed');
