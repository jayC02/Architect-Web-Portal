export const prerender = false;

import type { CalendarProvider } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { getGoogleCalendarConfigurationStatus } from '@/lib/integrations/google-calendar';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { withPerf } from '@/lib/utils/perf';
import { requireOrganisation } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation, membership } = await requireOrganisation(context);
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
          _count: { select: { events: { where: { syncStatus: 'SYNCED' } } } },
        },
        orderBy: { provider: 'asc' },
      });
    });

    return jsonResponse(200, {
      connections: connections.map(({ _count, ...connection }) => ({
        ...connection,
        syncedEventCount: _count.events,
      })),
      canManage: ['OWNER', 'ADMIN'].includes(membership.role),
      googleConfigured: getGoogleCalendarConfigurationStatus().configured,
    });
  }, context);
