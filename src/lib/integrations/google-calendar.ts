import crypto from 'node:crypto';
import {
  CalendarConnectionStatus,
  CalendarProvider,
  DeadlineManagedBy,
  DeadlineStatus,
  DeadlineType,
  PlanningStatus,
  WarrantStatus,
  type CalendarConnection,
} from '@prisma/client';
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

export type CalendarMilestoneKind = 'PLANNING_DECISION' | 'BUILDING_WARRANT_DECISION';

export type ManagedCalendarMilestone = {
  organisationId: string;
  syncKey: string;
  title: string;
  description: string;
  location?: string | null;
  startsAt: Date;
  actionUrl: string;
};

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

const withoutGoogleNotifications = (path: string) =>
  `${path}${path.includes('?') ? '&' : '?'}sendUpdates=none`;

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const nextDay = (value: Date) => {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + 1);
  return result;
};

const readableDate = (value: Date) => new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
}).format(value);

const importantManualDeadlineTypes = new Set<DeadlineType>([
  DeadlineType.PLANNING_DECISION,
  DeadlineType.WARRANT_RESPONSE,
  DeadlineType.WARRANT_EXPIRY,
  DeadlineType.COMPLETION_CERTIFICATE,
  DeadlineType.CLIENT_ACTION,
  DeadlineType.INSPECTION,
  DeadlineType.CUSTOM,
]);

const importantCanonicalDeadlineTypes = new Set<DeadlineType>([
  DeadlineType.PLANNING_DECISION,
  DeadlineType.WARRANT_RESPONSE,
  DeadlineType.WARRANT_EXPIRY,
  DeadlineType.COMPLETION_CERTIFICATE,
  DeadlineType.INSPECTION,
]);

export const isGoogleCalendarDeadlineEligible = (deadline: {
  managedBy: DeadlineManagedBy;
  type: DeadlineType;
  sourceKey: string | null;
}) => {
  if (deadline.type === DeadlineType.INTERNAL_TASK) return false;
  if (deadline.sourceKey?.startsWith('automation-job:')) return false;
  if (deadline.managedBy === DeadlineManagedBy.WORKFLOW) return false;
  if (deadline.managedBy === DeadlineManagedBy.MANUAL) return importantManualDeadlineTypes.has(deadline.type);
  if (deadline.managedBy === DeadlineManagedBy.GMAIL) {
    if (!deadline.sourceKey?.startsWith('gmail:')) return false;
    if (importantCanonicalDeadlineTypes.has(deadline.type)) return true;
    return deadline.type === DeadlineType.CUSTOM && deadline.sourceKey.endsWith(':informationResponse');
  }
  return importantCanonicalDeadlineTypes.has(deadline.type);
};

const deadlineActionUrl = (deadline: NonNullable<DeadlineForSync>) => {
  if (!deadline.projectId) return absoluteUrl('/deadlines');
  if (deadline.planningApplicationId) return absoluteUrl(`/projects/${deadline.projectId}#planning`);
  if (deadline.buildingWarrantApplicationId) return absoluteUrl(`/projects/${deadline.projectId}#building-warrant`);
  return absoluteUrl(`/projects/${deadline.projectId}`);
};

const deadlineSummary = (deadline: NonNullable<DeadlineForSync>) => {
  const date = readableDate(deadline.dueDate);
  if (deadline.sourceKey?.endsWith(':informationResponse') && deadline.planningApplicationId) {
    return `Planning information due — ${date}`;
  }
  if (deadline.type === DeadlineType.WARRANT_RESPONSE) return `Building Warrant response due — ${date}`;
  if (deadline.type === DeadlineType.WARRANT_EXPIRY) return `Building Warrant expires — ${date}`;
  if (deadline.type === DeadlineType.PLANNING_DECISION) return `Planning decision due — ${date}`;
  return deadline.title;
};

export const buildGoogleDeadlineEvent = (deadline: NonNullable<DeadlineForSync>) => {
  const projectUrl = deadlineActionUrl(deadline);
  const address = deadline.project?.siteAddress || deadline.project?.name;
  const isPlanningInformationRequest = deadline.sourceKey?.endsWith(':informationResponse')
    && Boolean(deadline.planningApplicationId);
  const details = isPlanningInformationRequest ? [
    `${deadline.project?.localAuthority || 'The planning authority'} has requested further information for ${address}.`,
    `Response due: ${readableDate(deadline.dueDate)}`,
    deadline.planningApplication?.applicationReference
      ? `Application: ${deadline.planningApplication.applicationReference}`
      : null,
    `Open Planning application:\n${projectUrl}`,
  ].filter(Boolean).join('\n\n') : [
    deadline.description,
    address ? `Project/site: ${address}` : null,
    deadline.planningApplication?.applicationReference
      ? `Planning application: ${deadline.planningApplication.applicationReference}`
      : null,
    deadline.buildingWarrantApplication?.warrantReference
      ? `Building Warrant: ${deadline.buildingWarrantApplication.warrantReference}`
      : null,
    `Due: ${readableDate(deadline.dueDate)}`,
    `Open in Architect Pro:\n${projectUrl}`,
  ].filter(Boolean).join('\n\n');
  const reminderMinutes = deadline.reminderDate
    ? Math.round((deadline.dueDate.getTime() - deadline.reminderDate.getTime()) / 60_000)
    : null;
  const reminders = reminderMinutes && reminderMinutes > 0 && reminderMinutes <= 40_320
    ? { useDefault: false, overrides: [{ method: 'popup', minutes: reminderMinutes }] }
    : { useDefault: true };

  return {
    summary: deadlineSummary(deadline),
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
        architectPortalManaged: 'true',
      },
    },
  };
};

const loadDeadlineForSync = (organisationId: string, deadlineId: string) => prisma.deadline.findFirst({
  where: { id: deadlineId, organisationId },
  include: {
    project: { select: { id: true, name: true, siteAddress: true, localAuthority: true } },
    planningApplication: { select: { id: true, applicationReference: true } },
    buildingWarrantApplication: { select: { id: true, warrantReference: true } },
  },
});

const activeDeadlineStatuses: DeadlineStatus[] = [
  DeadlineStatus.UPCOMING,
  DeadlineStatus.DUE_SOON,
  DeadlineStatus.OVERDUE,
];

export const googleDeadlineSyncKey = (organisationId: string, deadlineId: string) =>
  `${organisationId}:GOOGLE:${deadlineId}`;

export const googleDeadlineEventId = (organisationId: string, deadlineId: string) =>
  `ap${crypto.createHash('sha256').update(`${organisationId}:${deadlineId}`).digest('hex')}`;

export const googleCalendarMilestoneSyncKey = (
  organisationId: string,
  scope: 'planning' | 'warrant',
  aggregateId: string,
) => `${organisationId}:GOOGLE:${scope}:${aggregateId}:decision`;

export const googleManagedEventId = (syncKey: string) =>
  `ap${crypto.createHash('sha256').update(syncKey).digest('hex')}`;

export const buildPlanningDecisionMilestone = (input: {
  organisationId: string;
  planningApplicationId: string;
  projectId: string;
  projectName: string;
  siteAddress: string | null;
  applicationReference: string | null;
  decisionDate: Date;
  status: 'APPROVED' | 'REFUSED';
}): ManagedCalendarMilestone => {
  const approved = input.status === 'APPROVED';
  const actionUrl = absoluteUrl(`/projects/${input.projectId}#${approved ? 'building-warrant' : 'planning'}`);
  const place = input.siteAddress || input.projectName;
  return {
    organisationId: input.organisationId,
    syncKey: googleCalendarMilestoneSyncKey(input.organisationId, 'planning', input.planningApplicationId),
    title: approved
      ? 'Planning approved — Building Warrant ready'
      : 'Planning refused — review decision',
    startsAt: input.decisionDate,
    location: input.siteAddress,
    actionUrl,
    description: [
      `Planning permission has been ${approved ? 'approved' : 'refused'} for ${place}.`,
      `Decision: ${approved ? 'Approved' : 'Refused'}`,
      input.applicationReference ? `Application: ${input.applicationReference}` : null,
      `Decision date: ${readableDate(input.decisionDate)}`,
      approved
        ? 'The project is now ready to progress to Building Warrant.'
        : 'Review the decision notice and agree the next Planning action.',
      `${approved ? 'Open Building Warrant area' : 'Open Planning application'}:\n${actionUrl}`,
    ].filter(Boolean).join('\n\n'),
  };
};

export const buildBuildingWarrantGrantedMilestone = (input: {
  organisationId: string;
  buildingWarrantApplicationId: string;
  projectId: string;
  projectName: string;
  siteAddress: string | null;
  warrantReference: string | null;
  grantedDate: Date;
}): ManagedCalendarMilestone => {
  const actionUrl = absoluteUrl(`/projects/${input.projectId}#building-warrant`);
  const place = input.siteAddress || input.projectName;
  return {
    organisationId: input.organisationId,
    syncKey: googleCalendarMilestoneSyncKey(input.organisationId, 'warrant', input.buildingWarrantApplicationId),
    title: 'Building Warrant granted',
    startsAt: input.grantedDate,
    location: input.siteAddress,
    actionUrl,
    description: [
      `Building Warrant has been granted for ${place}.`,
      'Decision: Granted',
      input.warrantReference ? `Application: ${input.warrantReference}` : null,
      `Decision date: ${readableDate(input.grantedDate)}`,
      'Review the grant conditions and progress the next project action.',
      `Open Building Warrant:\n${actionUrl}`,
    ].filter(Boolean).join('\n\n'),
  };
};

const buildGoogleMilestoneEvent = (milestone: ManagedCalendarMilestone) => ({
  summary: milestone.title,
  description: milestone.description,
  location: milestone.location ?? undefined,
  start: { date: dateOnly(milestone.startsAt) },
  end: { date: dateOnly(nextDay(milestone.startsAt)) },
  transparency: 'transparent',
  visibility: 'default',
  reminders: { useDefault: true },
  extendedProperties: {
    private: {
      architectPortalOrganisationId: milestone.organisationId,
      architectPortalSyncKey: milestone.syncKey,
      architectPortalManaged: 'true',
    },
  },
});

export const isArchitectProManagedCalendarRecord = (
  record: { organisationId: string; deadlineId: string | null; syncKey: string | null },
  organisationId: string,
) => record.organisationId === organisationId && (
  Boolean(record.deadlineId)
  || Boolean(record.syncKey?.startsWith(`${organisationId}:GOOGLE:`))
);

const markConnectionFailure = async (connectionId: string, error: unknown) => {
  const message = error instanceof Error ? error.message.slice(0, 500) : 'Google Calendar sync failed.';
  await prisma.calendarConnection.updateMany({
    where: { id: connectionId },
    data: { status: CalendarConnectionStatus.ERROR, syncError: message },
  });
};

const deleteGoogleEvent = async (accessToken: string, providerEventId: string) => {
  try {
    await googleRequest<void>(accessToken, withoutGoogleNotifications(
      `/calendars/primary/events/${encodeURIComponent(providerEventId)}`,
    ), { method: 'DELETE' });
  } catch (error) {
    if ((error as HttpError & { googleStatus?: number }).googleStatus !== 404) throw error;
  }
};

const syncDeadlineWithToken = async (connection: CalendarConnection, accessToken: string, deadline: NonNullable<DeadlineForSync>) => {
  const syncKey = googleDeadlineSyncKey(deadline.organisationId, deadline.id);
  const existing = await prisma.syncedCalendarEvent.findFirst({
    where: {
      organisationId: deadline.organisationId,
      provider: CalendarProvider.GOOGLE,
      deadlineId: deadline.id,
    },
  });

  if (!activeDeadlineStatuses.includes(deadline.status) || !isGoogleCalendarDeadlineEligible(deadline)) {
    if (existing?.providerEventId) await deleteGoogleEvent(accessToken, existing.providerEventId);
    if (existing) await prisma.syncedCalendarEvent.delete({ where: { id: existing.id } });
    return existing ? 'deleted' as const : 'ignored' as const;
  }

  const eventBody = buildGoogleDeadlineEvent(deadline);
  let googleEvent: GoogleEventResponse | null = null;
  if (existing?.providerEventId) {
    try {
      googleEvent = await googleRequest<GoogleEventResponse>(
        accessToken,
        withoutGoogleNotifications(`/calendars/primary/events/${encodeURIComponent(existing.providerEventId)}`),
        { method: 'PUT', body: JSON.stringify(eventBody) },
      );
    } catch (error) {
      if ((error as HttpError & { googleStatus?: number }).googleStatus !== 404) throw error;
    }
  }
  if (!googleEvent) {
    const deterministicEventId = googleDeadlineEventId(deadline.organisationId, deadline.id);
    try {
      googleEvent = await googleRequest<GoogleEventResponse>(accessToken, withoutGoogleNotifications('/calendars/primary/events'), {
        method: 'POST',
        body: JSON.stringify({ id: deterministicEventId, ...eventBody }),
      });
    } catch (error) {
      if ((error as HttpError & { googleStatus?: number }).googleStatus !== 409) throw error;
      googleEvent = await googleRequest<GoogleEventResponse>(
        accessToken,
        withoutGoogleNotifications(`/calendars/primary/events/${encodeURIComponent(deterministicEventId)}`),
        { method: 'PUT', body: JSON.stringify(eventBody) },
      );
    }
  }
  if (!googleEvent.id) throw new HttpError(502, 'Google Calendar did not return an event id.');

  await prisma.syncedCalendarEvent.upsert({
    where: existing ? { id: existing.id } : { syncKey },
    update: {
      calendarConnectionId: connection.id,
      syncKey,
      providerEventId: googleEvent.id,
      title: eventBody.summary,
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
      syncKey,
      providerEventId: googleEvent.id,
      title: eventBody.summary,
      startsAt: deadline.dueDate,
      endsAt: nextDay(deadline.dueDate),
      syncStatus: 'SYNCED',
      lastSyncedAt: new Date(),
    },
  });
  return 'synced' as const;
};

const syncMilestoneWithToken = async (
  connection: CalendarConnection,
  accessToken: string,
  milestone: ManagedCalendarMilestone,
) => {
  const existing = await prisma.syncedCalendarEvent.findUnique({ where: { syncKey: milestone.syncKey } });
  if (existing && (
    existing.organisationId !== milestone.organisationId
    || existing.provider !== CalendarProvider.GOOGLE
  )) {
    throw new Error('Calendar milestone sync key is bound outside its organisation or provider.');
  }

  const eventBody = buildGoogleMilestoneEvent(milestone);
  let googleEvent: GoogleEventResponse | null = null;
  if (existing?.providerEventId) {
    try {
      googleEvent = await googleRequest<GoogleEventResponse>(
        accessToken,
        withoutGoogleNotifications(`/calendars/primary/events/${encodeURIComponent(existing.providerEventId)}`),
        { method: 'PUT', body: JSON.stringify(eventBody) },
      );
    } catch (error) {
      if ((error as HttpError & { googleStatus?: number }).googleStatus !== 404) throw error;
    }
  }
  if (!googleEvent) {
    const deterministicEventId = googleManagedEventId(milestone.syncKey);
    try {
      googleEvent = await googleRequest<GoogleEventResponse>(
        accessToken,
        withoutGoogleNotifications('/calendars/primary/events'),
        { method: 'POST', body: JSON.stringify({ id: deterministicEventId, ...eventBody }) },
      );
    } catch (error) {
      if ((error as HttpError & { googleStatus?: number }).googleStatus !== 409) throw error;
      googleEvent = await googleRequest<GoogleEventResponse>(
        accessToken,
        withoutGoogleNotifications(`/calendars/primary/events/${encodeURIComponent(deterministicEventId)}`),
        { method: 'PUT', body: JSON.stringify(eventBody) },
      );
    }
  }
  if (!googleEvent.id) throw new HttpError(502, 'Google Calendar did not return an event id.');

  await prisma.syncedCalendarEvent.upsert({
    where: { syncKey: milestone.syncKey },
    update: {
      calendarConnectionId: connection.id,
      deadlineId: null,
      providerEventId: googleEvent.id,
      title: milestone.title,
      startsAt: milestone.startsAt,
      endsAt: nextDay(milestone.startsAt),
      syncStatus: 'SYNCED',
      lastSyncedAt: new Date(),
    },
    create: {
      organisationId: milestone.organisationId,
      calendarConnectionId: connection.id,
      deadlineId: null,
      provider: CalendarProvider.GOOGLE,
      syncKey: milestone.syncKey,
      providerEventId: googleEvent.id,
      title: milestone.title,
      startsAt: milestone.startsAt,
      endsAt: nextDay(milestone.startsAt),
      syncStatus: 'SYNCED',
      lastSyncedAt: new Date(),
    },
  });
};

const removeMilestoneWithToken = async (
  organisationId: string,
  accessToken: string,
  syncKey: string,
) => {
  const existing = await prisma.syncedCalendarEvent.findFirst({
    where: { organisationId, provider: CalendarProvider.GOOGLE, syncKey },
  });
  if (!existing) return false;
  if (existing.providerEventId) await deleteGoogleEvent(accessToken, existing.providerEventId);
  await prisma.syncedCalendarEvent.delete({ where: { id: existing.id } });
  return true;
};

const loadCalendarMilestone = async (
  organisationId: string,
  kind: CalendarMilestoneKind,
  aggregateId: string,
) => {
  if (kind === 'PLANNING_DECISION') {
    const application = await prisma.planningApplication.findFirst({
      where: { id: aggregateId, organisationId },
      include: { project: { select: { id: true, name: true, siteAddress: true } } },
    });
    if (!application || !new Set<PlanningStatus>([PlanningStatus.APPROVED, PlanningStatus.REFUSED]).has(application.status)) return null;
    return buildPlanningDecisionMilestone({
      organisationId,
      planningApplicationId: application.id,
      projectId: application.project.id,
      projectName: application.project.name,
      siteAddress: application.project.siteAddress,
      applicationReference: application.applicationReference,
      decisionDate: application.decisionDate ?? application.updatedAt,
      status: application.status === PlanningStatus.APPROVED ? 'APPROVED' : 'REFUSED',
    });
  }

  const application = await prisma.buildingWarrantApplication.findFirst({
    where: { id: aggregateId, organisationId },
    include: { project: { select: { id: true, name: true, siteAddress: true } } },
  });
  if (!application || application.status !== WarrantStatus.GRANTED) return null;
  return buildBuildingWarrantGrantedMilestone({
    organisationId,
    buildingWarrantApplicationId: application.id,
    projectId: application.project.id,
    projectName: application.project.name,
    siteAddress: application.project.siteAddress,
    warrantReference: application.warrantReference,
    grantedDate: application.grantedDate ?? application.updatedAt,
  });
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

export const reconcileLifecycleCalendarMilestoneBestEffort = async (
  organisationId: string,
  kind: CalendarMilestoneKind,
  aggregateId: string,
) => {
  const connection = await getConnectedGoogleCalendar(organisationId);
  if (!connection) return { attempted: false };
  try {
    const accessToken = await getGoogleAccessToken(connection);
    const milestone = await loadCalendarMilestone(organisationId, kind, aggregateId);
    if (milestone) {
      await syncMilestoneWithToken(connection, accessToken, milestone);
    } else {
      const scope = kind === 'PLANNING_DECISION' ? 'planning' : 'warrant';
      await removeMilestoneWithToken(
        organisationId,
        accessToken,
        googleCalendarMilestoneSyncKey(organisationId, scope, aggregateId),
      );
    }
    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: { status: CalendarConnectionStatus.CONNECTED, lastSyncedAt: new Date(), syncError: null },
    });
    return { attempted: true, synced: true };
  } catch (error) {
    console.error('Google Calendar milestone reconciliation failed', { organisationId, kind, aggregateId, error });
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
    const [deadlines, planningDecisions, warrantDecisions] = await Promise.all([
      prisma.deadline.findMany({
        where: { organisationId },
        include: {
          project: { select: { id: true, name: true, siteAddress: true, localAuthority: true } },
          planningApplication: { select: { id: true, applicationReference: true } },
          buildingWarrantApplication: { select: { id: true, warrantReference: true } },
        },
        orderBy: { dueDate: 'asc' },
      }),
      prisma.planningApplication.findMany({
        where: { organisationId, status: { in: [PlanningStatus.APPROVED, PlanningStatus.REFUSED] } },
        include: { project: { select: { id: true, name: true, siteAddress: true } } },
      }),
      prisma.buildingWarrantApplication.findMany({
        where: { organisationId, status: WarrantStatus.GRANTED },
        include: { project: { select: { id: true, name: true, siteAddress: true } } },
      }),
    ]);
    let synced = 0;
    let removed = 0;
    let milestones = 0;
    const activeSyncKeys = new Set<string>();
    for (const deadline of deadlines) {
      const result = await syncDeadlineWithToken(connection, accessToken, deadline);
      if (result === 'synced') {
        synced += 1;
        activeSyncKeys.add(googleDeadlineSyncKey(organisationId, deadline.id));
      } else if (result === 'deleted') removed += 1;
    }
    for (const application of planningDecisions) {
      const milestone = buildPlanningDecisionMilestone({
        organisationId,
        planningApplicationId: application.id,
        projectId: application.project.id,
        projectName: application.project.name,
        siteAddress: application.project.siteAddress,
        applicationReference: application.applicationReference,
        decisionDate: application.decisionDate ?? application.updatedAt,
        status: application.status === PlanningStatus.APPROVED ? 'APPROVED' : 'REFUSED',
      });
      await syncMilestoneWithToken(connection, accessToken, milestone);
      activeSyncKeys.add(milestone.syncKey);
      synced += 1;
      milestones += 1;
    }
    for (const application of warrantDecisions) {
      const milestone = buildBuildingWarrantGrantedMilestone({
        organisationId,
        buildingWarrantApplicationId: application.id,
        projectId: application.project.id,
        projectName: application.project.name,
        siteAddress: application.project.siteAddress,
        warrantReference: application.warrantReference,
        grantedDate: application.grantedDate ?? application.updatedAt,
      });
      await syncMilestoneWithToken(connection, accessToken, milestone);
      activeSyncKeys.add(milestone.syncKey);
      synced += 1;
      milestones += 1;
    }
    const existingEvents = await prisma.syncedCalendarEvent.findMany({
      where: { organisationId, provider: CalendarProvider.GOOGLE },
    });
    for (const event of existingEvents) {
      if (!isArchitectProManagedCalendarRecord(event, organisationId)) continue;
      if (event.syncKey && activeSyncKeys.has(event.syncKey)) continue;
      if (event.providerEventId) await deleteGoogleEvent(accessToken, event.providerEventId);
      await prisma.syncedCalendarEvent.delete({ where: { id: event.id } });
      removed += 1;
    }
    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: { status: CalendarConnectionStatus.CONNECTED, lastSyncedAt: new Date(), syncError: null },
    });
    return { synced, milestones, removed };
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
