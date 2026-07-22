export const prerender = false;

import { CalendarProvider, DeadlineStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { getCalendarGridRange, normaliseCalendarMonth } from '@/lib/calendar/month';
import { prisma } from '@/lib/db/prisma';
import { requireOrganisation } from '@/server/permissions/authz';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { withPerf } from '@/lib/utils/perf';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const requestedMonth = new URL(context.request.url).searchParams.get('month');
    const month = normaliseCalendarMonth(requestedMonth);
    const { gridStart, gridEnd } = getCalendarGridRange(month);

    const [deadlines, googleConnection] = await withPerf('api.calendar.month', () => Promise.all([
      prisma.deadline.findMany({
        where: {
          organisationId: organisation.id,
          status: { not: DeadlineStatus.CANCELLED },
          dueDate: { gte: gridStart, lt: gridEnd },
        },
        orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }, { title: 'asc' }],
        select: {
          id: true,
          title: true,
          dueDate: true,
          status: true,
          priority: true,
          type: true,
          project: { select: { id: true, name: true } },
        },
      }),
      prisma.calendarConnection.findUnique({
        where: {
          organisationId_provider: {
            organisationId: organisation.id,
            provider: CalendarProvider.GOOGLE,
          },
        },
        select: { status: true, accountEmail: true, lastSyncedAt: true, syncError: true },
      }),
    ]));

    return jsonResponse(200, {
      month,
      gridStart,
      gridEnd,
      deadlines,
      googleConnection,
    });
  }, context);
