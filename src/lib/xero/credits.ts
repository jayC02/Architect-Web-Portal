import { Prisma } from '@prisma/client';
export type CreditNote = { CreditNoteID?: string; Type?: string; Status?: string; CurrencyCode?: string; SubTotal?: string | number; TotalTax?: string | number; Total?: string | number; Allocations?: Array<{ AllocationID?: string; Amount?: string | number; Invoice?: { InvoiceID?: string } }> };
export type CreditSnapshot = { status: string; currency: string; subtotal: Prisma.Decimal; totalTax: Prisma.Decimal; total: Prisma.Decimal; allocations: unknown };
/** Partial mixed-tax allocations have no trustworthy net basis in the API. */
export function reconcileInvoiceCredits(invoiceId: string, currency: string, amountCredited: Prisma.Decimal | null, notes: CreditSnapshot[]) {
  if (amountCredited === null) return null;
  if (amountCredited.isZero()) return new Prisma.Decimal(0);
  let gross = new Prisma.Decimal(0), net = new Prisma.Decimal(0);
  let unknown = false;
  for (const note of notes) {
    if (!['AUTHORISED', 'PAID'].includes(note.status) || note.currency !== currency || !Array.isArray(note.allocations)) continue;
    for (const allocation of note.allocations) {
      if (allocation.invoiceId !== invoiceId) continue;
      const amount = new Prisma.Decimal(allocation.amount);
      gross = gross.plus(amount);
      if (amount.equals(note.total)) net = net.plus(note.subtotal);
      else if (note.totalTax.isZero()) net = net.plus(amount);
      else unknown = true;
    }
  }
  return unknown || !gross.equals(amountCredited) ? null : net;
}
