import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
export type FinanceInvoice = { xeroInvoiceId: string; invoiceType: string; status: string; currency: string; subtotal: Prisma.Decimal; total: Prisma.Decimal; amountPaid: Prisma.Decimal; amountDue: Prisma.Decimal; amountCredited: Prisma.Decimal | null; netCredited: Prisma.Decimal | null; dueDate: Date | null };
export type FinanceTotals = { invoiced: Prisma.Decimal; netInvoiced: Prisma.Decimal | null; paid: Prisma.Decimal; credited: Prisma.Decimal | null; outstanding: Prisma.Decimal; overdue: Prisma.Decimal; remaining: Prisma.Decimal | null };
const zero = () => new Prisma.Decimal(0);
export const londonDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export function calculateProjectFinance(invoices: FinanceInvoice[], agreement: { agreedAmount: Prisma.Decimal | null; currency: string; vatTreatment: string } | null, now = new Date()) {
  const totals = new Map<string, FinanceTotals>();
  for (const invoice of invoices) {
    if (invoice.invoiceType !== 'ACCREC' || !['AUTHORISED', 'PAID'].includes(invoice.status)) continue;
    const current = totals.get(invoice.currency) ?? { invoiced: zero(), netInvoiced: zero(), paid: zero(), credited: zero(), outstanding: zero(), overdue: zero(), remaining: null };
    current.invoiced = current.invoiced.plus(invoice.total);
    // Invoice cash totals are authoritative. Payment snapshots are not added again.
    current.paid = current.paid.plus(invoice.amountPaid);
    current.outstanding = current.outstanding.plus(invoice.amountDue);
    if (invoice.dueDate && invoice.dueDate.toISOString().slice(0, 10) < londonDate(now)) current.overdue = current.overdue.plus(invoice.amountDue);
    current.credited = current.credited !== null && invoice.amountCredited !== null ? current.credited.plus(invoice.amountCredited) : null;
    current.netInvoiced = current.netInvoiced !== null && invoice.netCredited !== null ? current.netInvoiced.plus(invoice.subtotal.minus(invoice.netCredited)) : null;
    totals.set(invoice.currency, current);
  }
  if (agreement) {
    const current = totals.get(agreement.currency) ?? { invoiced: zero(), netInvoiced: zero(), paid: zero(), credited: zero(), outstanding: zero(), overdue: zero(), remaining: null };
    if (agreement.agreedAmount !== null && agreement.vatTreatment !== 'LEGACY_UNKNOWN' && current.netInvoiced !== null) current.remaining = agreement.agreedAmount.minus(current.netInvoiced);
    totals.set(agreement.currency, current);
  }
  return totals;
}
export function rankInvoiceSuggestions<T extends { xeroInvoiceId: string; reference: string | null; xeroContactId: string; invoiceType: string; status: string }>(invoices: T[], input: { projectReference: string | null; clientContactId: string | null; milestoneIds: string[] }) {
  return invoices.filter(invoice => invoice.invoiceType === 'ACCREC' && !['VOIDED', 'DELETED'].includes(invoice.status)).map(invoice => {
    const reasons: string[] = []; let score = 0;
    const reference = invoice.reference?.trim().toLowerCase();
    if (reference && input.projectReference && reference === input.projectReference.trim().toLowerCase()) { score += 100; reasons.push('Exact project reference'); }
    if (reference && input.milestoneIds.some(id => reference === `ap:${id}`.toLowerCase())) { score += 100; reasons.push('Exact project milestone reference'); }
    if (input.clientContactId && invoice.xeroContactId === input.clientContactId) { score += 20; reasons.push('Linked client contact'); }
    return { ...invoice, score, reasons };
  }).sort((a, b) => b.score - a.score);
}
export async function loadProjectFinance(organisationId: string, project: { id: string; clientId: string | null; internalReference: string | null }, agreement: { agreedAmount: Prisma.Decimal | null; currency: string; vatTreatment: string; milestones: { id: string }[] } | null, now = new Date()) {
  const connection = await prisma.xeroConnection.findUnique({ where: { organisationId } });
  if (!connection) return null;
  const clientLink = project.clientId ? await prisma.xeroClientLink.findFirst({ where: { clientId: project.clientId, organisationId, connectionId: connection.id } }) : null;
  const [links, invoices] = await Promise.all([
    prisma.xeroProjectInvoiceLink.findMany({ where: { organisationId, projectId: project.id, connectionId: connection.id }, include: { invoice: true }, orderBy: { linkedAt: 'desc' } }),
    prisma.xeroInvoiceSnapshot.findMany({ where: { organisationId, connectionId: connection.id, invoiceType: 'ACCREC', projectLinks: { none: {} } }, orderBy: { invoiceDate: 'desc' }, take: 300 }),
  ]);
  const stale = !connection.lastSyncedAt || now.getTime() - connection.lastSyncedAt.getTime() > 24 * 60 * 60 * 1000;
  const current = !stale && ['CONNECTED', 'SYNCING'].includes(connection.status) && !connection.lastSyncError;
  return { connection, links, clientLink, stale, current, totals: current ? calculateProjectFinance(links.map(link => link.invoice), agreement, now) : new Map<string, FinanceTotals>(), candidates: rankInvoiceSuggestions(invoices, { projectReference: project.internalReference, clientContactId: clientLink?.xeroContactId ?? null, milestoneIds: agreement?.milestones.map(row => row.id) ?? [] }) };
}
