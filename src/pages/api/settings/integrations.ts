export const prerender = false;

import type { CalendarProvider } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { withPerf } from '@/lib/utils/perf';
import { requireOrganisation } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const connections = await withPerf('api.settings.integrations', async () => {
      const existing = await prisma.calendarConnection.findMany({
        where: { organisationId: organisation.id },
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
        orderBy: { provider: 'asc' },
      });
    });

    return jsonResponse(200, { connections });
  });
