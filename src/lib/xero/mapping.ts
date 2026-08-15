import type { XeroReport, XeroReportRow } from '@/lib/xero/types';

export const parseXeroDate = (value: string | null | undefined) => {
  if (!value) return null;
  const legacy = /\/Date\((\d+)(?:[+-]\d+)?\)\//.exec(value);
  const parsed = legacy ? new Date(Number(legacy[1])) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const decimalString = (value: string | number | null | undefined) => {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00';
};

const normalized = (value: string | undefined) => (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');

export const flattenReportRows = (rows: XeroReportRow[] = []): XeroReportRow[] => rows.flatMap((row) => [
  row,
  ...flattenReportRows(row.Rows ?? []),
]);

export const reportValueByLabels = (report: XeroReport, labels: string[]) => {
  const wanted = new Set(labels.map(normalized));
  for (const row of flattenReportRows(report.Rows)) {
    const label = normalized(row.Cells?.[0]?.Value ?? row.Title);
    if (!wanted.has(label)) continue;
    const values = (row.Cells ?? []).slice(1).map((cell) => Number(cell.Value?.replace(/,/g, ''))).filter(Number.isFinite);
    if (values.length) return decimalString(values[values.length - 1]);
  }
  return null;
};

export const parseProfitAndLoss = (report: XeroReport) => ({
  revenue: reportValueByLabels(report, ['Total Income', 'Total Revenue', 'Revenue']),
  netProfit: reportValueByLabels(report, ['Net Profit', 'Net Profit/(Loss)', 'Net Profit (Loss)']),
});

export const boundedReportSummary = (report: XeroReport) => ({
  reportName: report.ReportName ?? null,
  reportTitles: (report.ReportTitles ?? []).slice(0, 5),
  reportDate: report.ReportDate ?? null,
});

export const parseAgedReceivables = (report: XeroReport) => {
  const candidateRows = flattenReportRows(report.Rows)
    .map((row) => (row.Cells ?? []).slice(1)
      .map((cell) => Number(cell.Value?.replace(/,/g, '')))
      .filter(Number.isFinite))
    .filter((values) => values.length >= 5);
  const values = candidateRows.at(-1) ?? [];
  const buckets = values.length >= 6 ? values.slice(-6) : [];
  return buckets.length === 6 ? {
    currentAmount: decimalString(buckets[0]),
    days1To30: decimalString(buckets[1]),
    days31To60: decimalString(buckets[2]),
    days61To90: decimalString(buckets[3]),
    days91Plus: decimalString(buckets[4]),
    total: decimalString(buckets[5]),
  } : null;
};

export const xeroInvoiceDeepLink = (shortCode: string | null | undefined, invoiceId: string) => shortCode
  ? `https://go.xero.com/app/${encodeURIComponent(shortCode)}/invoicing/view/${encodeURIComponent(invoiceId)}`
  : null;

export const xeroContactDeepLink = (shortCode: string | null | undefined, contactId: string) => shortCode
  ? `https://go.xero.com/app/${encodeURIComponent(shortCode)}/contacts/contact/${encodeURIComponent(contactId)}`
  : null;
