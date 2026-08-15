export const prerender = false;

import { Prisma } from '@prisma/client';
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { normaliseMatchValue } from '@/lib/xero/metrics';
import { xeroContactDeepLink, xeroInvoiceDeepLink } from '@/lib/xero/mapping';
import { requireOrganisationRole } from '@/server/permissions/authz';

const linkSchema = z.object({ xeroContactId: z.string().uuid() });
const moneyTotals = (invoices: Array<{ currency: string; total: Prisma.Decimal; amountPaid: Prisma.Decimal; amountDue: Prisma.Decimal; dueDate: Date | null; status: string }>) => {
  const now = new Date();
  const totals = new Map<string, { invoiced: Prisma.Decimal; paid: Prisma.Decimal; outstanding: Prisma.Decimal; overdue: Prisma.Decimal }>();
  invoices.filter((invoice) => ['AUTHORISED', 'PAID'].includes(invoice.status)).forEach((invoice) => {
    const current = totals.get(invoice.currency) ?? { invoiced: new Prisma.Decimal(0), paid: new Prisma.Decimal(0), outstanding: new Prisma.Decimal(0), overdue: new Prisma.Decimal(0) };
    current.invoiced = current.invoiced.plus(invoice.total);
    current.paid = current.paid.plus(invoice.amountPaid);
    current.outstanding = current.outstanding.plus(invoice.amountDue);
    if (invoice.dueDate && invoice.dueDate < now && invoice.amountDue.greaterThan(0)) current.overdue = current.overdue.plus(invoice.amountDue);
    totals.set(invoice.currency, current);
  });
  return Object.fromEntries([...totals].map(([currency, value]) => [currency, Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, amount.toFixed(2)]))]));
};

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const clientId = context.params.id;
  if (!clientId) throw new HttpError(400, 'Client id is required.');
  const [client, connection] = await Promise.all([
    prisma.client.findFirst({ where: { id: clientId, organisationId: organisation.id } }),
    prisma.xeroConnection.findUnique({ where: { organisationId: organisation.id } }),
  ]);
  if (!client) throw new HttpError(404, 'Client not found.');
  if (!connection) return jsonResponse(200, { connected: false });
  const link = await prisma.xeroClientLink.findUnique({
    where: { clientId },
    include: { xeroContact: true },
  });
  const contacts = await prisma.xeroContactSnapshot.findMany({
    where: { organisationId: organisation.id, contactStatus: { not: 'ARCHIVED' } },
    orderBy: [{ isCustomer: 'desc' }, { name: 'asc' }],
    take: 250,
    select: { xeroContactId: true, name: true, email: true, accountNumber: true, isCustomer: true },
  });
  const name = normaliseMatchValue(client.companyName || client.name);
  const email = normaliseMatchValue(client.email);
  const suggestions = contacts.filter((contact) =>
    (name && normaliseMatchValue(contact.name) === name)
    || (email && normaliseMatchValue(contact.email) === email));
  if (!link) return jsonResponse(200, { connected: true, link: null, contacts, suggestions });

  const invoices = await prisma.xeroInvoiceSnapshot.findMany({
    where: { organisationId: organisation.id, xeroContactId: link.xeroContactId },
    orderBy: { invoiceDate: 'desc' },
    select: { xeroInvoiceId: true, invoiceNumber: true, invoiceDate: true, dueDate: true, status: true, currency: true, total: true, amountPaid: true, amountDue: true },
  });
  const lastPayment = await prisma.xeroPaymentSnapshot.findFirst({
    where: { organisationId: organisation.id, invoice: { xeroContactId: link.xeroContactId } },
    orderBy: { paymentDate: 'desc' },
    select: { paymentDate: true },
  });
  return jsonResponse(200, {
    connected: true,
    contacts,
    suggestions,
    link: {
      xeroContactId: link.xeroContactId,
      name: link.xeroContact.name,
      email: link.xeroContact.email,
      accountNumber: link.xeroContact.accountNumber,
      xeroUrl: xeroContactDeepLink(connection.xeroShortCode, link.xeroContactId),
      totals: moneyTotals(invoices),
      lastInvoiceDate: invoices[0]?.invoiceDate ?? null,
      lastPaymentDate: lastPayment?.paymentDate ?? null,
      recentInvoices: invoices.slice(0, 6).map((invoice) => ({
        ...invoice,
        total: invoice.total.toFixed(2),
        amountPaid: invoice.amountPaid.toFixed(2),
        amountDue: invoice.amountDue.toFixed(2),
        xeroUrl: xeroInvoiceDeepLink(connection.xeroShortCode, invoice.xeroInvoiceId),
      })),
    },
  });
}, context);

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'xero:client-link');
  const { organisation, user } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const clientId = context.params.id;
  if (!clientId) throw new HttpError(400, 'Client id is required.');
  const { xeroContactId } = await parseBody(context.request, linkSchema);
  const [client, connection] = await Promise.all([
    prisma.client.findFirst({ where: { id: clientId, organisationId: organisation.id }, select: { id: true } }),
    prisma.xeroConnection.findUnique({ where: { organisationId: organisation.id } }),
  ]);
  if (!client || !connection) throw new HttpError(404, 'Client or Xero connection not found.');
  const contact = await prisma.xeroContactSnapshot.findUnique({
    where: { connectionId_xeroContactId: { connectionId: connection.id, xeroContactId } },
  });
  if (!contact || contact.organisationId !== organisation.id) throw new HttpError(404, 'Xero contact not found.');
  try {
    await prisma.xeroClientLink.upsert({
      where: { clientId },
      create: { organisationId: organisation.id, connectionId: connection.id, clientId, xeroContactId, linkedByUserId: user.id },
      update: { connectionId: connection.id, xeroContactId, linkedByUserId: user.id, linkedAt: new Date() },
    });
  } catch {
    throw new HttpError(409, 'That Xero contact is already linked to another client.');
  }
  return jsonResponse(200, { ok: true });
}, context);

export const DELETE: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.mutation, 'xero:client-unlink');
  const { organisation } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const clientId = context.params.id;
  if (!clientId) throw new HttpError(400, 'Client id is required.');
  await prisma.xeroClientLink.deleteMany({ where: { clientId, organisationId: organisation.id } });
  return jsonResponse(200, { ok: true });
}, context);
