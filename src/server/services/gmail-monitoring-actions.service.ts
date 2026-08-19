import { ActionItemKind, ActionItemPriority, ActionItemStatus, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

const DEDUPE_KEY = 'gmail:connection:reconnect';

export const upsertGmailReconnectAction = (
  organisationId: string,
  summary: string,
  database: PrismaClient = prisma,
) => database.actionItem.upsert({
  where: { organisationId_dedupeKey: { organisationId, dedupeKey: DEDUPE_KEY } },
  update: {
    title: 'Gmail monitoring paused — reconnect Google',
    summary: summary.slice(0, 500),
    actionUrl: '/settings/integrations',
    priority: ActionItemPriority.HIGH,
    status: ActionItemStatus.OPEN,
    resolvedAt: null,
  },
  create: {
    organisationId,
    projectId: null,
    sourceLifecycleEventId: null,
    kind: ActionItemKind.GMAIL_MONITORING,
    title: 'Gmail monitoring paused — reconnect Google',
    summary: summary.slice(0, 500),
    actionUrl: '/settings/integrations',
    priority: ActionItemPriority.HIGH,
    dedupeKey: DEDUPE_KEY,
  },
});

export const resolveGmailReconnectAction = (
  organisationId: string,
  database: PrismaClient = prisma,
) => database.actionItem.updateMany({
  where: { organisationId, dedupeKey: DEDUPE_KEY, status: ActionItemStatus.OPEN },
  data: { status: ActionItemStatus.RESOLVED, resolvedAt: new Date() },
});
