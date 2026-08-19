export const prerender = false;

import type { CalendarProvider } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { getGoogleCalendarConfigurationStatus } from '@/lib/integrations/google-calendar';
import { getXeroConfigurationStatus, hasXeroDraftInvoiceScope } from '@/lib/xero/config';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { withPerf } from '@/lib/utils/perf';
import { requireOrganisation } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation, membership } = await requireOrganisation(context);
    const canManage = ['OWNER', 'ADMIN'].includes(membership.role);
    const connections = await withPerf('api.settings.integrations', async () => {
      const existing = await prisma.calendarConnection.findMany({
        where: { organisationId: organisation.id },
        select: { provider: true },
        orderBy: { provider: 'asc' },
      });
      const existingProviders = new Set(existing.map((connection) => connection.provider));
      const missingProviders = (['GOOGLE', 'OUTLOOK'] as CalendarProvider[]).filter((provider) => !existingProviders.has(provider));
      if (missingProviders.length) {
        await prisma.calendarConnection.createMany({
          data: missingProviders.map((provider) => ({ organisationId: organisation.id, provider })),
          skipDuplicates: true,
        });
      }
      return prisma.calendarConnection.findMany({
        where: { organisationId: organisation.id },
        select: {
          id: true,
          provider: true,
          status: true,
          accountEmail: true,
          lastSyncedAt: true,
          syncError: true,
          grantedScopes: true,
          gmailEnabled: true,
          gmailRequireReview: true,
          gmailAutoApplyHighConfidence: true,
          gmailLastSuccessfulSyncAt: true,
          gmailLastAttemptedSyncAt: true,
          gmailSyncError: true,
          _count: { select: { events: { where: { syncStatus: 'SYNCED' } } } },
        },
        orderBy: { provider: 'asc' },
      });
    });

    const xero = canManage ? await prisma.xeroConnection.findUnique({
      where: { organisationId: organisation.id },
      select: {
        id: true,
        xeroTenantName: true,
        status: true,
        baseCurrency: true,
        grantedScopes: true,
        lastSyncedAt: true,
        lastSyncError: true,
        _count: { select: { contacts: true, invoices: true, payments: true } },
      },
    }) : null;
    const financeSettings = canManage ? await prisma.organisationFinanceSettings.findUnique({ where: { organisationId: organisation.id } }) : null;

    return jsonResponse(200, {
      connections: connections.map(({ _count, grantedScopes, ...connection }) => ({
        ...connection,
        gmailPermissionGranted: Boolean(grantedScopes?.split(/\s+/).includes('https://www.googleapis.com/auth/gmail.readonly')),
        syncedEventCount: _count.events,
      })),
      canManage,
      googleConfigured: getGoogleCalendarConfigurationStatus().configured,
      xeroConfigured: getXeroConfigurationStatus().configured,
      financeSettings,
      xero: xero ? {
        ...xero,
        draftInvoicePermissionGranted: hasXeroDraftInvoiceScope(xero.grantedScopes),
        snapshotCounts: { contacts: xero._count.contacts, invoices: xero._count.invoices, payments: xero._count.payments },
        _count: undefined,
      } : null,
    });
  }, context);
