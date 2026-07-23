import crypto from 'node:crypto';
import { CalendarConnectionStatus, CalendarProvider, DeadlineStatus, type CalendarConnection } from '@prisma/client';
import { absoluteUrl } from '@/lib/config';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
export const GOOGLE_GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GOOGLE_BASE_SCOPES = [
  'openid',
  'email',
];

type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: Buffer;
  stateSecret: string;
};

type OAuthState = {
  organisationId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
  capability?: 'calendar' | 'gmail';
};

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GoogleEventResponse = {
  id?: string;
  htmlLink?: string;
};

type DeadlineForSync = Awaited<ReturnType<typeof loadDeadlineForSync>>;

const requiredEnvironmentValue = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new HttpError(503, 'Google Calendar is not configured on this server.');
  return value;
};

const readEncryptionKey = () => {
  const encoded = requiredEnvironmentValue('GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new HttpError(503, 'Google Calendar token encryption is not configured correctly.');
  }
  return key;
};

export const getGoogleCalendarConfigurationStatus = () => ({
  configured: Boolean(
    process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim()
    && process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim()
    && process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY?.trim()
    && process.env.GOOGLE_CALENDAR_OAUTH_STATE_SECRET?.trim()
    && (process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim() || process.env.PUBLIC_SITE_URL?.trim()),
  ),
});

const getGoogleConfig = (): GoogleConfig => ({
  clientId: requiredEnvironmentValue('GOOGLE_CALENDAR_CLIENT_ID'),
  clientSecret: requiredEnvironmentValue('GOOGLE_CALENDAR_CLIENT_SECRET'),
  redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim()
    || absoluteUrl('/api/integrations/google-calendar/callback'),
  encryptionKey: readEncryptionKey(),
  stateSecret: requiredEnvironmentValue('GOOGLE_CALENDAR_OAUTH_STATE_SECRET'),
});

const encode = (value: string | Buffer) => Buffer.from(value).toString('base64url');
const decode = (value: string) => Buffer.from(value, 'base64url').toString('utf8');

export const encryptGoogleToken = (value: string, key: Buffer) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${encode(iv)}.${encode(tag)}.${encode(encrypted)}`;
};

export const decryptGoogleToken = (value: string, key: Buffer) => {
  const [version, ivValue, tagValue, encryptedValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('Stored Google token is invalid.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};

export const signGoogleOAuthState = (payload: OAuthState, secret: string) => {
  const encodedPayload = encode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
};

export const verifyGoogleOAuthState = (state: string, secret: string): OAuthState => {
  const [encodedPayload, submittedSignature] = state.split('.');
  if (!encodedPayload || !submittedSignature) throw new HttpError(400, 'Invalid Google Calendar connection state.');
  const expectedSignature = crypto.createHmac('sha256', secret).update(encodedPayload).digest();
  const submitted = Buffer.from(submittedSignature, 'base64url');
  if (submitted.length !== expectedSignature.length || !crypto.timingSafeEqual(submitted, expectedSignature)) {
    throw new HttpError(400, 'Invalid Google Calendar connection state.');
  }
  const payload = JSON.parse(decode(encodedPayload)) as OAuthState;
  if (!payload.organisationId || !payload.userId || !payload.nonce || payload.expiresAt < Date.now()) {
    throw new HttpError(400, 'Google Calendar connection request has expired.');
  }
  return payload;
};

export const createGoogleAuthorizationUrl = (
  input: Omit<OAuthState, 'expiresAt'>,
  capability: 'calendar' | 'gmail' = 'calendar',
) => {
  const config = getGoogleConfig();
  const state = signGoogleOAuthState({
    ...input,
    capability,
    expiresAt: Date.now() + 10 * 60 * 1000,
  }, config.stateSecret);
  const scopes = [
    ...GOOGLE_BASE_SCOPES,
    GOOGLE_CALENDAR_SCOPE,
    ...(capability === 'gmail' ? [GOOGLE_GMAIL_READONLY_SCOPE] : []),
  ].join(' ');
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  }).toString();
  return url.toString();
};

const parseGoogleResponse = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const nestedMessage = typeof payload.error === 'object' && payload.error
      ? (payload.error as { message?: unknown }).message
      : undefined;
    const message = typeof nestedMessage === 'string'
      ? nestedMessage
      : typeof payload.error_description === 'string'
        ? payload.error_description
        : 'Google Calendar request failed.';
    const error = new HttpError(response.status === 401 ? 401 : 502, message);
    (error as HttpError & { googleStatus?: number }).googleStatus = response.status;
    throw error;
  }
  return payload as T;
};

export const exchangeGoogleAuthorizationCode = async (code: string) => {
  const config = getGoogleConfig();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  return parseGoogleResponse<GoogleTokenResponse>(response);
};

const refreshGoogleAccessToken = async (connection: CalendarConnection) => {
  const config = getGoogleConfig();
  if (!connection.refreshTokenEncrypted) throw new HttpError(409, 'Reconnect Google Calendar to restore automatic sync.');
  const refreshToken = decryptGoogleToken(connection.refreshTokenEncrypted, config.encryptionKey);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const tokens = await parseGoogleResponse<GoogleTokenResponse>(response);
  if (!tokens.access_token) throw new HttpError(502, 'Google did not return a usable access token.');
  await prisma.calendarConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEncrypted: encryptGoogleToken(tokens.access_token, config.encryptionKey),
      accessTokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      grantedScopes: tokens.scope ?? connection.grantedScopes,
    },
  });
  return tokens.access_token;
};

export const getGoogleAccessToken = async (connection: CalendarConnection) => {
  const config = getGoogleConfig();
  if (
    connection.accessTokenEncrypted
    && connection.accessTokenExpiresAt
    && connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000
  ) {
    return decryptGoogleToken(connection.accessTokenEncrypted, config.encryptionKey);
  }
  return refreshGoogleAccessToken(connection);
};

const googleRequest = async <T>(accessToken: string, path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${accessToken}`);
  if (init.body) headers.set('content-type', 'application/json');
  const response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, { ...init, headers });
  if (response.status === 204) return undefined as T;
  return parseGoogleResponse<T>(response);
};

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const nextDay = (value: Date) => {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + 1);
  return result;
};

export const buildGoogleDeadlineEvent = (deadline: NonNullable<DeadlineForSync>) => {
  const projectUrl = deadline.projectId ? absoluteUrl(`/projects/${deadline.projectId}`) : absoluteUrl('/deadlines');
  const details = [
    deadline.description,
    deadline.project ? `Project: ${deadline.project.name}` : null,
    `Type: ${deadline.type.replaceAll('_', ' ').toLowerCase()}`,
    `Priority: ${deadline.priority.toLowerCase()}`,
    `Open in Architect Web Portal: ${projectUrl}`,
  ].filter(Boolean).join('\n\n');
  const reminderMinutes = deadline.reminderDate
    ? Math.round((deadline.dueDate.getTime() - deadline.reminderDate.getTime()) / 60_000)
    : null;
  const reminders = reminderMinutes && reminderMinutes > 0 && reminderMinutes <= 40_320
    ? { useDefault: false, overrides: [{ method: 'popup', minutes: reminderMinutes }] }
    : { useDefault: true };

  return {
    summary: deadline.project ? `${deadline.title} - ${deadline.project.name}` : deadline.title,
    description: details,
    location: deadline.project?.siteAddress ?? undefined,
    start: { date: dateOnly(deadline.dueDate) },
    end: { date: dateOnly(nextDay(deadline.dueDate)) },
    transparency: 'transparent',
    visibility: 'default',
    reminders,
    extendedProperties: {
      private: {
        architectPortalDeadlineId: deadline.id,
        architectPortalOrganisationId: deadline.organisationId,
      },
    },
  };
};

const loadDeadlineForSync = (organisationId: string, deadlineId: string) => prisma.deadline.findFirst({
  where: { id: deadlineId, organisationId },
  include: { project: { select: { id: true, name: true, siteAddress: true } } },
});

const activeDeadlineStatuses: DeadlineStatus[] = [
  DeadlineStatus.UPCOMING,
  DeadlineStatus.DUE_SOON,
  DeadlineStatus.OVERDUE,
];

const markConnectionFailure = async (connectionId: string, error: unknown) => {
  const message = error instanceof Error ? error.message.slice(0, 500) : 'Google Calendar sync failed.';
  await prisma.calendarConnection.updateMany({
    where: { id: connectionId },
    data: { status: CalendarConnectionStatus.ERROR, syncError: message },
  });
};

const deleteGoogleEvent = async (accessToken: string, providerEventId: string) => {
  try {
    await googleRequest<void>(accessToken, `/calendars/primary/events/${encodeURIComponent(providerEventId)}`, { method: 'DELETE' });
  } catch (error) {
    if ((error as HttpError & { googleStatus?: number }).googleStatus !== 404) throw error;
  }
};

const syncDeadlineWithToken = async (connection: CalendarConnection, accessToken: string, deadline: NonNullable<DeadlineForSync>) => {
  const existing = await prisma.syncedCalendarEvent.findFirst({
    where: {
      organisationId: deadline.organisationId,
      provider: CalendarProvider.GOOGLE,
      deadlineId: deadline.id,
    },
  });

  if (!activeDeadlineStatuses.includes(deadline.status)) {
    if (existing?.providerEventId) await deleteGoogleEvent(accessToken, existing.providerEventId);
    if (existing) {
      await prisma.syncedCalendarEvent.update({
        where: { id: existing.id },
        data: { providerEventId: null, syncStatus: 'DELETED', lastSyncedAt: new Date() },
      });
    }
    return 'deleted' as const;
  }

  const eventBody = buildGoogleDeadlineEvent(deadline);
  let googleEvent: GoogleEventResponse | null = null;
  if (existing?.providerEventId) {
    try {
      googleEvent = await googleRequest<GoogleEventResponse>(
        accessToken,
        `/calendars/primary/events/${encodeURIComponent(existing.providerEventId)}`,
        { method: 'PUT', body: JSON.stringify(eventBody) },
      );
    } catch (error) {
      if ((error as HttpError & { googleStatus?: number }).googleStatus !== 404) throw error;
    }
  }
  if (!googleEvent) {
    googleEvent = await googleRequest<GoogleEventResponse>(accessToken, '/calendars/primary/events', {
      method: 'POST',
      body: JSON.stringify(eventBody),
    });
  }
  if (!googleEvent.id) throw new HttpError(502, 'Google Calendar did not return an event id.');

  await prisma.syncedCalendarEvent.upsert({
    where: existing ? { id: existing.id } : { id: '__new_google_calendar_event__' },
    update: {
      calendarConnectionId: connection.id,
      providerEventId: googleEvent.id,
      title: deadline.title,
      startsAt: deadline.dueDate,
      endsAt: nextDay(deadline.dueDate),
      syncStatus: 'SYNCED',
      lastSyncedAt: new Date(),
    },
    create: {
      organisationId: deadline.organisationId,
      calendarConnectionId: connection.id,
      deadlineId: deadline.id,
      provider: CalendarProvider.GOOGLE,
      providerEventId: googleEvent.id,
      title: deadline.title,
      startsAt: deadline.dueDate,
      endsAt: nextDay(deadline.dueDate),
      syncStatus: 'SYNCED',
      lastSyncedAt: new Date(),
    },
  });
  return 'synced' as const;
};

const getConnectedGoogleCalendar = (organisationId: string) => prisma.calendarConnection.findFirst({
  where: {
    organisationId,
    provider: CalendarProvider.GOOGLE,
    status: { in: [CalendarConnectionStatus.CONNECTED, CalendarConnectionStatus.ERROR] },
    refreshTokenEncrypted: { not: null },
  },
});

export const syncDeadlineToGoogleBestEffort = async (organisationId: string, deadlineId: string) => {
  const connection = await getConnectedGoogleCalendar(organisationId);
  if (!connection) return { attempted: false };
  const deadline = await loadDeadlineForSync(organisationId, deadlineId);
  if (!deadline) return { attempted: false };
  try {
    const accessToken = await getGoogleAccessToken(connection);
    await syncDeadlineWithToken(connection, accessToken, deadline);
    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: { status: CalendarConnectionStatus.CONNECTED, lastSyncedAt: new Date(), syncError: null },
    });
    return { attempted: true, synced: true };
  } catch (error) {
    console.error('Google Calendar deadline sync failed', { organisationId, deadlineId, error });
    await markConnectionFailure(connection.id, error);
    return { attempted: true, synced: false };
  }
};

export const removeDeadlineFromGoogleBestEffort = async (organisationId: string, deadlineId: string) => {
  const connection = await getConnectedGoogleCalendar(organisationId);
  if (!connection) return { attempted: false };
  const existing = await prisma.syncedCalendarEvent.findFirst({
    where: { organisationId, provider: CalendarProvider.GOOGLE, deadlineId },
  });
  if (!existing?.providerEventId) return { attempted: false };
  try {
    const accessToken = await getGoogleAccessToken(connection);
    await deleteGoogleEvent(accessToken, existing.providerEventId);
    await prisma.syncedCalendarEvent.delete({ where: { id: existing.id } });
    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: { status: CalendarConnectionStatus.CONNECTED, lastSyncedAt: new Date(), syncError: null },
    });
    return { attempted: true, synced: true };
  } catch (error) {
    console.error('Google Calendar deadline removal failed', { organisationId, deadlineId, error });
    await markConnectionFailure(connection.id, error);
    return { attempted: true, synced: false };
  }
};

export const syncAllGoogleDeadlines = async (organisationId: string) => {
  const connection = await getConnectedGoogleCalendar(organisationId);
  if (!connection) throw new HttpError(409, 'Connect Google Calendar before syncing deadlines.');
  try {
    const accessToken = await getGoogleAccessToken(connection);
    const [deadlines, existingEvents] = await Promise.all([
      prisma.deadline.findMany({
        where: { organisationId },
        include: { project: { select: { id: true, name: true, siteAddress: true } } },
        orderBy: { dueDate: 'asc' },
      }),
      prisma.syncedCalendarEvent.findMany({
        where: { organisationId, provider: CalendarProvider.GOOGLE },
        include: { deadline: { select: { id: true, status: true } } },
      }),
    ]);
    let synced = 0;
    let removed = 0;
    for (const deadline of deadlines) {
      const result = await syncDeadlineWithToken(connection, accessToken, deadline);
      if (result === 'synced') synced += 1;
      else removed += 1;
    }
    const deadlineIds = new Set(deadlines.map((deadline) => deadline.id));
    for (const event of existingEvents) {
      if (event.deadlineId && deadlineIds.has(event.deadlineId)) continue;
      if (event.providerEventId) await deleteGoogleEvent(accessToken, event.providerEventId);
      await prisma.syncedCalendarEvent.delete({ where: { id: event.id } });
      removed += 1;
    }
    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: { status: CalendarConnectionStatus.CONNECTED, lastSyncedAt: new Date(), syncError: null },
    });
    return { synced, removed };
  } catch (error) {
    await markConnectionFailure(connection.id, error);
    throw error;
  }
};

export const connectGoogleCalendar = async (organisationId: string, tokens: GoogleTokenResponse) => {
  const config = getGoogleConfig();
  if (!tokens.access_token) throw new HttpError(502, 'Google did not return an access token.');
  const existing = await prisma.calendarConnection.findUnique({
    where: { organisationId_provider: { organisationId, provider: CalendarProvider.GOOGLE } },
  });
  const refreshToken = tokens.refresh_token
    ? encryptGoogleToken(tokens.refresh_token, config.encryptionKey)
    : existing?.refreshTokenEncrypted;
  if (!refreshToken) throw new HttpError(409, 'Google did not provide offline access. Reconnect and approve calendar access.');
  const userInfo = await parseGoogleResponse<{ email?: string }>(await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  }));
  return prisma.calendarConnection.upsert({
    where: { organisationId_provider: { organisationId, provider: CalendarProvider.GOOGLE } },
    update: {
      status: CalendarConnectionStatus.CONNECTED,
      accountEmail: userInfo.email ?? null,
      externalId: 'primary',
      accessTokenEncrypted: encryptGoogleToken(tokens.access_token, config.encryptionKey),
      refreshTokenEncrypted: refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      grantedScopes: tokens.scope ?? [...GOOGLE_BASE_SCOPES, GOOGLE_CALENDAR_SCOPE].join(' '),
      syncError: null,
    },
    create: {
      organisationId,
      provider: CalendarProvider.GOOGLE,
      status: CalendarConnectionStatus.CONNECTED,
      accountEmail: userInfo.email ?? null,
      externalId: 'primary',
      accessTokenEncrypted: encryptGoogleToken(tokens.access_token, config.encryptionKey),
      refreshTokenEncrypted: refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      grantedScopes: tokens.scope ?? [...GOOGLE_BASE_SCOPES, GOOGLE_CALENDAR_SCOPE].join(' '),
    },
  });
};

export const googleConnectionHasGmailScope = (connection: Pick<CalendarConnection, 'grantedScopes'> | null | undefined) =>
  Boolean(connection?.grantedScopes?.split(/\s+/).includes(GOOGLE_GMAIL_READONLY_SCOPE));

export const disconnectGoogleCalendar = async (organisationId: string) => {
  const config = getGoogleConfig();
  const connection = await prisma.calendarConnection.findUnique({
    where: { organisationId_provider: { organisationId, provider: CalendarProvider.GOOGLE } },
  });
  if (!connection) return;
  const syncedEvents = await prisma.syncedCalendarEvent.findMany({
    where: { organisationId, provider: CalendarProvider.GOOGLE, providerEventId: { not: null } },
    select: { providerEventId: true },
  });
  try {
    const accessToken = await getGoogleAccessToken(connection);
    for (const event of syncedEvents) {
      if (event.providerEventId) await deleteGoogleEvent(accessToken, event.providerEventId);
    }
  } catch (error) {
    console.error('Could not remove every synced Google event during disconnect', { organisationId, error });
  }
  const encryptedToken = connection.refreshTokenEncrypted ?? connection.accessTokenEncrypted;
  if (encryptedToken) {
    const token = decryptGoogleToken(encryptedToken, config.encryptionKey);
    await fetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    }).catch(() => undefined);
  }
  await prisma.$transaction([
    prisma.syncedCalendarEvent.deleteMany({
      where: { organisationId, provider: CalendarProvider.GOOGLE },
    }),
    prisma.calendarConnection.update({
      where: { id: connection.id },
      data: {
        status: CalendarConnectionStatus.NOT_CONNECTED,
        accountEmail: null,
        externalId: null,
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        accessTokenExpiresAt: null,
        grantedScopes: null,
        lastSyncedAt: null,
        syncError: null,
      },
    }),
  ]);
};

export const verifyGoogleOAuthCallbackState = (state: string) => {
  const config = getGoogleConfig();
  return verifyGoogleOAuthState(state, config.stateSecret);
};
