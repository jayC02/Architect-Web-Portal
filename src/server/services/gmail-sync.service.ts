import {
  CalendarConnectionStatus,
  CalendarProvider,
  GmailMatchStatus,
  GmailPlanningClassification,
  GmailProcessingStatus,
  GmailSuggestionStatus,
  GmailUpdateType,
  PlanningStatus,
  Prisma,
  WarrantStatus,
  type CalendarConnection,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getGoogleAccessToken, googleConnectionHasGmailScope } from '@/lib/integrations/google-calendar';
import {
  extractGmailUpdates,
  isLikelyProjectEmail,
  matchEmailToProjects,
  parseGmailMessage,
  type GmailMessagePayload,
  type GmailProjectCandidate,
  type ParsedGmailMessage,
} from '@/lib/integrations/gmail-tracking';
import { HttpError } from '@/lib/utils/http';
import { applyGmailSuggestion, gmailSuggestionDedupeKey } from '@/server/services/gmail-updates.service';
import { processPlanningClassification } from '@/server/services/gmail-planning-lifecycle.service';
import { resolveGmailReconnectAction, upsertGmailReconnectAction } from '@/server/services/gmail-monitoring-actions.service';
import {
  ingestGmailProjectDocument,
  isLikelyDecisionNoticeAttachment,
} from '@/server/services/gmail-document-ingestion.service';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const DEFAULT_INITIAL_SYNC_DAYS = 30;
const DEFAULT_MESSAGE_LIMIT = 120;
const LEASE_MINUTES = 10;

type GmailApiError = HttpError & { googleStatus?: number };
type GmailListResponse = { messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string };
type GmailHistoryResponse = {
  history?: Array<{ messagesAdded?: Array<{ message?: { id?: string; threadId?: string } }> }>;
  historyId?: string;
  nextPageToken?: string;
};

const configuredInteger = (name: string, fallback: number, max: number) => {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, max);
};

export const gmailSyncConfiguration = {
  initialDays: () => configuredInteger('GMAIL_INITIAL_SYNC_DAYS', DEFAULT_INITIAL_SYNC_DAYS, 365),
  messageLimit: () => configuredInteger('GMAIL_SYNC_MESSAGE_LIMIT', DEFAULT_MESSAGE_LIMIT, 500),
  organisationLimit: () => configuredInteger('GMAIL_SYNC_ORGANISATION_LIMIT', 25, 100),
  autoApplyThreshold: () => {
    const value = Number(process.env.GMAIL_AUTO_APPLY_THRESHOLD);
    return Number.isFinite(value) && value >= 0.9 && value <= 1 ? value : 0.97;
  },
};

const parseGoogleResponse = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const nested = typeof payload.error === 'object' && payload.error
      ? (payload.error as { message?: unknown }).message
      : null;
    const message = typeof nested === 'string' ? nested : 'Gmail request failed.';
    const error = new HttpError(response.status === 401 ? 401 : response.status === 404 ? 404 : 502, message) as GmailApiError;
    error.googleStatus = response.status;
    throw error;
  }
  return payload as T;
};

const gmailRequest = async <T>(accessToken: string, path: string) => parseGoogleResponse<T>(await fetch(`${GMAIL_API}${path}`, {
  headers: { authorization: `Bearer ${accessToken}` },
}));

const loadProjectCandidates = async (organisationId: string) => {
  const [projects, linkedThreads] = await Promise.all([
    prisma.project.findMany({
      where: {
        organisationId,
        status: { not: 'ARCHIVED' },
        OR: [
          { planningApplications: { some: { status: { in: [
            PlanningStatus.SUBMITTED,
            PlanningStatus.VALIDATED,
            PlanningStatus.IN_REVIEW,
            PlanningStatus.FURTHER_INFORMATION_REQUESTED,
          ] } } } },
          { warrantApplications: { some: { status: { in: [
            WarrantStatus.SUBMITTED,
            WarrantStatus.IN_REVIEW,
            WarrantStatus.FURTHER_INFORMATION_REQUESTED,
          ] } } } },
        ],
      },
      select: {
        id: true,
        name: true,
        internalReference: true,
        siteAddress: true,
        localAuthority: true,
        site: { select: { addressLine1: true, addressLine2: true, townCity: true, postcode: true, localAuthority: true } },
        client: { select: { email: true } },
        planningApplications: {
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            applicationReference: true,
            submissionDate: true,
            validDate: true,
            decisionTargetDate: true,
            decisionDate: true,
            status: true,
            updatedAt: true,
          },
        },
        warrantApplications: {
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            warrantReference: true,
            submissionDate: true,
            firstResponseTargetDate: true,
            grantedDate: true,
            expiryDate: true,
            completionCertificateStatus: true,
            status: true,
          },
        },
      },
    }),
    prisma.trackedEmail.findMany({
      where: { organisationId, matchStatus: GmailMatchStatus.MATCHED, projectId: { not: null } },
      select: { projectId: true, gmailThreadId: true },
      distinct: ['projectId', 'gmailThreadId'],
    }),
  ]);
  const threadsByProject = new Map<string, string[]>();
  for (const linked of linkedThreads) {
    if (!linked.projectId) continue;
    threadsByProject.set(linked.projectId, [...(threadsByProject.get(linked.projectId) ?? []), linked.gmailThreadId]);
  }
  return projects.map((project) => ({
    ...project,
    linkedThreadIds: threadsByProject.get(project.id) ?? [],
  }));
};

const officialProjectMessage = (email: Pick<ParsedGmailMessage, 'sender' | 'subject' | 'excerpt'>) =>
  /@(.*\.)?(gov\.uk|eplanning\.scot|edevelopment\.scot)$/i.test(email.sender)
  && /\b(planning|householder|building warrant|application|case officer|decision|validation)\b/i.test(`${email.subject} ${email.excerpt}`);

const listRecentMessageIds = async (accessToken: string) => {
  const ids: string[] = [];
  let pageToken: string | undefined;
  const limit = gmailSyncConfiguration.messageLimit();
  do {
    const query = new URLSearchParams({
      maxResults: String(Math.min(100, limit - ids.length)),
      q: `newer_than:${gmailSyncConfiguration.initialDays()}d -in:spam -in:trash`,
      ...(pageToken ? { pageToken } : {}),
    });
    const page = await gmailRequest<GmailListResponse>(accessToken, `/users/me/messages?${query}`);
    ids.push(...(page.messages ?? []).map((message) => message.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < limit);
  return ids.slice(0, limit);
};

const listHistoryMessageIds = async (accessToken: string, historyId: string) => {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId = historyId;
  const limit = gmailSyncConfiguration.messageLimit();
  do {
    const query = new URLSearchParams({
      startHistoryId: historyId,
      historyTypes: 'messageAdded',
      maxResults: '100',
      ...(pageToken ? { pageToken } : {}),
    });
    const page = await gmailRequest<GmailHistoryResponse>(accessToken, `/users/me/history?${query}`);
    for (const history of page.history ?? []) {
      for (const added of history.messagesAdded ?? []) {
        if (added.message?.id) ids.add(added.message.id);
        if (ids.size >= limit) break;
      }
    }
    latestHistoryId = page.historyId ?? latestHistoryId;
    pageToken = page.nextPageToken;
  } while (pageToken && ids.size < limit);
  return { ids: [...ids], historyId: latestHistoryId };
};

const readMessage = (accessToken: string, id: string, format: 'metadata' | 'full') => {
  const query = new URLSearchParams({ format });
  if (format === 'metadata') {
    for (const header of ['From', 'To', 'Cc', 'Subject', 'Date']) query.append('metadataHeaders', header);
  }
  return gmailRequest<GmailMessagePayload>(accessToken, `/users/me/messages/${encodeURIComponent(id)}?${query}`);
};

const readAttachmentBytes = async (accessToken: string, messageId: string, attachmentId: string) => {
  const payload = await gmailRequest<{ data?: string }>(
    accessToken,
    `/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  if (!payload.data) throw new Error('Gmail did not return attachment data.');
  return Buffer.from(payload.data, 'base64url');
};

const currentValueForUpdate = (
  candidate: Awaited<ReturnType<typeof loadProjectCandidates>>[number],
  updateType: GmailUpdateType,
  fieldName: string,
  planningApplicationId: string | null,
  warrantApplicationId: string | null,
) => {
  if (updateType === GmailUpdateType.PLANNING_APPLICATION) {
    const record = candidate.planningApplications.find((application) => application.id === planningApplicationId)
      ?? candidate.planningApplications[0];
    return record ? (record as unknown as Record<string, unknown>)[fieldName] : null;
  }
  if (updateType === GmailUpdateType.BUILDING_WARRANT) {
    const record = candidate.warrantApplications.find((application) => application.id === warrantApplicationId)
      ?? candidate.warrantApplications[0];
    return record ? (record as unknown as Record<string, unknown>)[fieldName] : null;
  }
  return null;
};

const serialisable = (value: unknown): Prisma.InputJsonValue | Prisma.JsonNullValueInput => {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined || value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
};

const persistCandidateMessage = async (
  organisationId: string,
  connection: CalendarConnection,
  accessToken: string,
  parsed: ParsedGmailMessage,
  candidates: Awaited<ReturnType<typeof loadProjectCandidates>>,
) => {
  const match = matchEmailToProjects(parsed, candidates as GmailProjectCandidate[]);
  const candidate = match.projectId ? candidates.find((project) => project.id === match.projectId) : null;
  const trackedData = {
      organisationId,
      gmailMessageId: parsed.gmailMessageId,
      gmailThreadId: parsed.gmailThreadId,
      sender: parsed.sender.slice(0, 500),
      recipients: parsed.recipients,
      subject: parsed.subject,
      sentAt: parsed.sentAt,
      textExcerpt: parsed.excerpt || null,
      matchStatus: match.status,
      processingStatus: match.status === 'MATCHED' ? GmailProcessingStatus.PROCESSED : GmailProcessingStatus.NEEDS_REVIEW,
      projectId: match.projectId,
      planningApplicationId: match.planningApplicationId,
      buildingWarrantApplicationId: match.buildingWarrantApplicationId,
      matchConfidence: match.confidence,
      matchReason: match.reason,
      processingError: null,
      processedAt: new Date(),
  };
  const tracked = await prisma.trackedEmail.upsert({
    where: { organisationId_gmailMessageId: { organisationId, gmailMessageId: parsed.gmailMessageId } },
    update: {
      ...trackedData,
      attachments: {
        createMany: {
          data: parsed.attachments.map((attachment) => ({ organisationId, ...attachment })),
          skipDuplicates: true,
        },
      },
    },
    create: {
      ...trackedData,
      attachments: {
        create: parsed.attachments.map((attachment) => ({ organisationId, ...attachment })),
      },
    },
  });

  const planningApplication = candidate
    ? candidate.planningApplications.find((application) => application.id === match.planningApplicationId)
      ?? candidate.planningApplications[0]
      ?? null
    : null;
  const planningContent = Boolean(planningApplication)
    || /\b(planning|householder|planning permission)\b/i.test(`${parsed.subject} ${parsed.text || parsed.excerpt}`);
  let classificationSuggestionId: string | null = null;
  let planningDecision: Awaited<ReturnType<typeof processPlanningClassification>> | null = null;
  if (planningContent) {
    const classification = await processPlanningClassification({
      organisationId,
      connection,
      trackedEmailId: tracked.id,
      matchStatus: match.status as GmailMatchStatus,
      parsed,
      project: candidate ? {
        id: candidate.id,
        name: candidate.name,
        localAuthority: candidate.site?.localAuthority ?? candidate.localAuthority,
      } : null,
      application: planningApplication ? {
        ...planningApplication,
        projectId: candidate!.id,
      } : null,
    });
    planningDecision = classification;
    classificationSuggestionId = classification.suggestionId;
  }

  if (
    planningDecision?.applied
    && candidate
    && (
      planningDecision.classification.classification === GmailPlanningClassification.DECISION_APPROVED
      || planningDecision.classification.classification === GmailPlanningClassification.DECISION_REFUSED
    )
  ) {
    const attachments = (await prisma.gmailAttachment.findMany({
      where: { trackedEmailId: tracked.id, organisationId, importedDocumentId: null },
    })).filter((attachment) => isLikelyDecisionNoticeAttachment({
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      subject: parsed.subject,
    }));
    if (attachments.length) {
      const member = await prisma.organisationMember.findFirst({
        where: { organisationId },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: { userId: true },
      });
      if (!member) throw new Error('No organisation member is available to own the imported Gmail document.');
      for (const attachment of attachments) {
        await ingestGmailProjectDocument({
          organisationId,
          projectId: candidate.id,
          trackedEmailId: tracked.id,
          gmailAttachmentId: attachment.id,
          gmailMessageId: parsed.gmailMessageId,
          filename: attachment.fileName,
          mimeType: attachment.mimeType,
          bytes: await readAttachmentBytes(accessToken, parsed.gmailMessageId, attachment.gmailAttachmentId),
          initiatedByUserId: member.userId,
          decisionNotice: true,
        });
      }
    }
  }

  if (!candidate || match.status !== 'MATCHED') {
    const refreshed = await prisma.trackedEmail.findUniqueOrThrow({ where: { id: tracked.id } });
    return { tracked: refreshed, suggestionIds: classificationSuggestionId ? [classificationSuggestionId] : [] as string[] };
  }
  const updates = extractGmailUpdates(parsed);
  const suggestionIds: string[] = classificationSuggestionId ? [classificationSuggestionId] : [];
  for (const update of updates) {
    const updateType = update.updateType as GmailUpdateType;
    if (
      updateType === GmailUpdateType.PLANNING_APPLICATION
      && ['status', 'submissionDate', 'validDate', 'decisionDate'].includes(update.fieldName)
    ) continue;
    const suggestedValue = update.deadline
      ? { ...update.deadline, dueDate: update.deadline.dueDate }
      : update.value;
    let existingValue = currentValueForUpdate(
      candidate,
      updateType,
      update.fieldName,
      match.planningApplicationId,
      match.buildingWarrantApplicationId,
    );
    if (updateType === GmailUpdateType.DEADLINE) {
      const sourceKey = `gmail:${parsed.gmailThreadId}:${candidate.id}:${update.fieldName}`;
      existingValue = (await prisma.deadline.findUnique({
        where: { organisationId_sourceKey: { organisationId, sourceKey } },
        select: { dueDate: true },
      }))?.dueDate ?? null;
    }
    const dedupeKey = gmailSuggestionDedupeKey({ updateType, fieldName: update.fieldName, value: suggestedValue });
    const suggestion = await prisma.gmailUpdateSuggestion.upsert({
      where: { trackedEmailId_dedupeKey: { trackedEmailId: tracked.id, dedupeKey } },
      update: {},
      create: {
        organisationId,
        trackedEmailId: tracked.id,
        projectId: candidate.id,
        planningApplicationId: match.planningApplicationId ?? candidate.planningApplications[0]?.id,
        buildingWarrantApplicationId: match.buildingWarrantApplicationId ?? candidate.warrantApplications[0]?.id,
        updateType,
        fieldName: update.fieldName,
        dedupeKey,
        existingValue: serialisable(existingValue),
        suggestedValue: serialisable(suggestedValue),
        confidence: Math.min(update.confidence, match.confidence),
        reason: `${update.reason} Project match: ${match.reason}`,
      },
    });
    suggestionIds.push(suggestion.id);
  }

  const pendingReviewCount = suggestionIds.length
    ? await prisma.gmailUpdateSuggestion.count({
        where: { id: { in: suggestionIds }, status: GmailSuggestionStatus.PENDING },
      })
    : 0;
  if (pendingReviewCount) {
    await prisma.trackedEmail.update({
      where: { id: tracked.id },
      data: { processingStatus: GmailProcessingStatus.NEEDS_REVIEW },
    });
  }

  const autoApply = connection.gmailAutoApplyHighConfidence && !connection.gmailRequireReview;
  if (autoApply) {
    const threshold = gmailSyncConfiguration.autoApplyThreshold();
    const eligible = await prisma.gmailUpdateSuggestion.findMany({
      where: {
        id: { in: suggestionIds },
        status: GmailSuggestionStatus.PENDING,
        confidence: { gte: threshold },
        fieldName: { not: 'status' },
      },
      select: { id: true },
    });
    for (const suggestion of eligible) {
      try {
        await applyGmailSuggestion({
          organisationId,
          suggestionId: suggestion.id,
          automatic: true,
        });
      } catch {
        // The apply service records the failure; one suggestion must not abort the mailbox sync.
      }
    }
  }

  const refreshed = await prisma.trackedEmail.findUniqueOrThrow({ where: { id: tracked.id } });
  return { tracked: refreshed, suggestionIds };
};

const acquireSyncLease = async (connection: CalendarConnection) => {
  const staleBefore = new Date(Date.now() - LEASE_MINUTES * 60_000);
  const now = new Date();
  const result = await prisma.calendarConnection.updateMany({
    where: {
      id: connection.id,
      gmailEnabled: true,
      OR: [{ gmailSyncStartedAt: null }, { gmailSyncStartedAt: { lt: staleBefore } }],
    },
    data: { gmailSyncStartedAt: now, gmailLastAttemptedSyncAt: now, gmailSyncError: null },
  });
  if (!result.count) throw new HttpError(409, 'A Gmail sync is already running for this organisation.');
};

export const syncOrganisationGmail = async (organisationId: string) => {
  const connection = await prisma.calendarConnection.findUnique({
    where: { organisationId_provider: { organisationId, provider: CalendarProvider.GOOGLE } },
  });
  if (!connection || !connection.gmailEnabled) throw new HttpError(409, 'Enable Gmail tracking before syncing.');
  if (!googleConnectionHasGmailScope(connection)) {
    await upsertGmailReconnectAction(organisationId, 'Gmail read permission is missing. Reconnect Google to resume monitoring.');
    throw new HttpError(409, 'Reconnect Google and approve Gmail read access.');
  }
  if (
    connection.status !== CalendarConnectionStatus.CONNECTED
    && connection.status !== CalendarConnectionStatus.ERROR
  ) {
    await upsertGmailReconnectAction(organisationId, 'The Google connection is unavailable. Reconnect it to resume Gmail monitoring.');
    throw new HttpError(409, 'Reconnect Google before syncing Gmail.');
  }
  await acquireSyncLease(connection);

  let imported = 0;
  let reviewed = 0;
  let skipped = 0;
  let failed = 0;
  try {
    const accessToken = await getGoogleAccessToken(connection);
    const candidates = await loadProjectCandidates(organisationId);
    let messageIds: string[];
    const startingHistoryId = connection.gmailHistoryId ?? null;
    let proposedHistoryId = startingHistoryId;
    if (startingHistoryId) {
      try {
        const history = await listHistoryMessageIds(accessToken, startingHistoryId);
        messageIds = history.ids;
        proposedHistoryId = history.historyId;
      } catch (error) {
        if ((error as GmailApiError).googleStatus !== 404) throw error;
        messageIds = await listRecentMessageIds(accessToken);
        proposedHistoryId = null;
      }
    } else {
      messageIds = await listRecentMessageIds(accessToken);
    }
    const existingIds = new Set((await prisma.trackedEmail.findMany({
      where: { organisationId, gmailMessageId: { in: messageIds } },
      select: { gmailMessageId: true, processingStatus: true },
    }))
      .filter((email) => email.processingStatus !== GmailProcessingStatus.FAILED)
      .map((email) => email.gmailMessageId));

    for (const messageId of messageIds) {
      if (existingIds.has(messageId)) {
        skipped += 1;
        continue;
      }
      try {
        const metadata = parseGmailMessage(await readMessage(accessToken, messageId, 'metadata'));
        if (!isLikelyProjectEmail(metadata, candidates as GmailProjectCandidate[]) && !officialProjectMessage(metadata)) {
          skipped += 1;
          continue;
        }
        const parsed = parseGmailMessage(await readMessage(accessToken, messageId, 'full'));
        const result = await persistCandidateMessage(organisationId, connection, accessToken, parsed, candidates);
        imported += 1;
        if (result.tracked.processingStatus === GmailProcessingStatus.NEEDS_REVIEW) reviewed += 1;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          skipped += 1;
          continue;
        }
        failed += 1;
        await prisma.trackedEmail.updateMany({
          where: { organisationId, gmailMessageId: messageId },
          data: {
            processingStatus: GmailProcessingStatus.FAILED,
            processingError: error instanceof Error ? error.message.slice(0, 500) : 'Candidate processing failed.',
          },
        });
        console.error('Gmail candidate processing failed', {
          organisationId,
          messageId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    if (!failed) {
      const profile = await gmailRequest<{ historyId?: string }>(accessToken, '/users/me/profile');
      proposedHistoryId = profile.historyId ?? proposedHistoryId;
    }
    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: {
        gmailHistoryId: failed ? startingHistoryId : proposedHistoryId,
        gmailLastSuccessfulSyncAt: failed ? connection.gmailLastSuccessfulSyncAt : new Date(),
        gmailSyncStartedAt: null,
        gmailSyncError: failed ? `${failed} candidate email${failed === 1 ? '' : 's'} could not be processed.` : null,
      },
    });
    if (!failed) await resolveGmailReconnectAction(organisationId);
    return { imported, needsReview: reviewed, skipped, failed };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Gmail sync failed.';
    await prisma.calendarConnection.updateMany({
      where: { id: connection.id },
      data: { gmailSyncStartedAt: null, gmailSyncError: message },
    });
    if ((error as GmailApiError).googleStatus === 401 || /reconnect|permission|token/i.test(message)) {
      await upsertGmailReconnectAction(organisationId, message);
    }
    throw error;
  }
};

export const disconnectGmailTracking = async (organisationId: string) => {
  const connection = await prisma.calendarConnection.findUnique({
    where: { organisationId_provider: { organisationId, provider: CalendarProvider.GOOGLE } },
  });
  if (!connection) return;
  await prisma.$transaction([
    prisma.trackedEmail.deleteMany({ where: { organisationId } }),
    prisma.calendarConnection.update({
      where: { id: connection.id },
      data: {
        gmailEnabled: false,
        gmailRequireReview: true,
        gmailAutoApplyHighConfidence: false,
        gmailHistoryId: null,
        gmailLastSuccessfulSyncAt: null,
        gmailLastAttemptedSyncAt: null,
        gmailSyncStartedAt: null,
        gmailSyncError: null,
      },
    }),
  ]);
};

export const syncAllEnabledGmailConnections = async () => {
  const connections = await prisma.calendarConnection.findMany({
    where: {
      provider: CalendarProvider.GOOGLE,
      gmailEnabled: true,
      refreshTokenEncrypted: { not: null },
    },
    select: { organisationId: true },
    orderBy: [{ gmailLastAttemptedSyncAt: 'asc' }, { organisationId: 'asc' }],
    take: gmailSyncConfiguration.organisationLimit(),
  });
  const results = [];
  for (const connection of connections) {
    try {
      results.push({ organisationId: connection.organisationId, ok: true, result: await syncOrganisationGmail(connection.organisationId) });
    } catch (error) {
      results.push({
        organisationId: connection.organisationId,
        ok: false,
        error: error instanceof Error ? error.message : 'Gmail sync failed.',
      });
    }
  }
  return results;
};
