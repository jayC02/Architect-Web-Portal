import crypto from 'node:crypto';
import type { APIContext } from 'astro';
import { XeroConnectionStatus } from '@prisma/client';
import { encryptGoogleToken as encryptToken, decryptGoogleToken as decryptToken } from '@/lib/integrations/google-calendar';
import { prisma } from '@/lib/db/prisma';
import { XERO_AUTHORIZE_URL, XERO_CONNECTIONS_URL, XERO_DRAFT_SCOPES, XERO_SCOPES, XERO_TOKEN_URL, getXeroConfig, xeroBasicAuthorization } from '@/lib/xero/config';
import { XeroOAuthStateInvalid, XeroTenantConflict } from '@/lib/xero/errors';
import type { XeroTenant, XeroTokenResponse } from '@/lib/xero/types';
import { HttpError } from '@/lib/utils/http';
import { getValidXeroAccessToken } from '@/lib/xero/token';

const XERO_SELECTION_COOKIE = 'architect_xero_tenant_selection';
const OAUTH_TTL_MS = 10 * 60 * 1000;

const hashOpaqueValue = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const createOpaqueValue = () => crypto.randomBytes(48).toString('base64url');

const secureCookie = () => ({
  httpOnly: true,
  secure: import.meta.env?.PROD || process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: Math.floor(OAUTH_TTL_MS / 1000),
});

const parseTokenResponse = async (response: Response) => {
  const payload = await response.json().catch(() => ({})) as XeroTokenResponse;
  if (!response.ok || !payload.access_token || !payload.refresh_token || !payload.expires_in) {
    throw new HttpError(502, response.ok
      ? 'Xero did not return a complete token set.'
      : 'Xero could not complete the connection request.');
  }
  return payload as Required<Pick<XeroTokenResponse, 'access_token' | 'refresh_token' | 'expires_in'>> & XeroTokenResponse;
};

export const createXeroAuthorizationUrl = async (organisationId: string, userId: string, options: { draftInvoices?: boolean } = {}) => {
  const config = getXeroConfig();
  const state = createOpaqueValue();
  await prisma.xeroOAuthState.create({
    data: {
      organisationId,
      userId,
      stateHash: hashOpaqueValue(state),
      expiresAt: new Date(Date.now() + OAUTH_TTL_MS),
    },
  });
  const url = new URL(XERO_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: (options.draftInvoices ? XERO_DRAFT_SCOPES : XERO_SCOPES).join(' '),
    state,
  }).toString();
  return url.toString();
};

export const consumeXeroOAuthState = async (state: string, organisationId: string, userId: string) => {
  const stateHash = hashOpaqueValue(state);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const attempt = await tx.xeroOAuthState.findUnique({ where: { stateHash } });
    if (!attempt || attempt.organisationId !== organisationId || attempt.userId !== userId) {
      throw new XeroOAuthStateInvalid();
    }
    const claimed = await tx.xeroOAuthState.updateMany({
      where: { id: attempt.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) throw new XeroOAuthStateInvalid();
    return attempt;
  });
};

export const exchangeXeroAuthorizationCode = async (code: string) => {
  const config = getXeroConfig();
  return parseTokenResponse(await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: xeroBasicAuthorization(config.clientId, config.clientSecret),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }),
  }));
};

export const getAuthorisedXeroTenants = async (accessToken: string) => {
  const response = await fetch(XERO_CONNECTIONS_URL, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (!response.ok) throw new HttpError(502, 'Xero organisation access could not be confirmed.');
  const tenants = await response.json().catch(() => []) as XeroTenant[];
  return tenants.filter((tenant) => tenant.id && tenant.tenantId && tenant.tenantName && tenant.tenantType !== 'PRACTICEMANAGER');
};

export const connectXeroTenant = async (
  organisationId: string,
  tenant: XeroTenant,
  tokens: Required<Pick<XeroTokenResponse, 'access_token' | 'refresh_token' | 'expires_in'>> & XeroTokenResponse,
) => {
  const config = getXeroConfig();
  const existing = await prisma.xeroConnection.findUnique({ where: { organisationId } });
  const data = {
    xeroConnectionId: tenant.id,
    xeroTenantId: tenant.tenantId,
    xeroTenantName: tenant.tenantName,
    accessTokenEncrypted: encryptToken(tokens.access_token, config.encryptionKey),
    refreshTokenEncrypted: encryptToken(tokens.refresh_token, config.encryptionKey),
    accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    grantedScopes: tokens.scope ?? XERO_SCOPES.join(' '),
    status: XeroConnectionStatus.CONNECTED,
    connectedAt: new Date(),
    lastSyncError: null,
  };
  try {
    if (existing && existing.xeroTenantId !== tenant.tenantId) {
      return prisma.$transaction(async (tx) => {
        await tx.xeroConnection.delete({ where: { id: existing.id } });
        return tx.xeroConnection.create({ data: { organisationId, ...data } });
      });
    }
    return prisma.xeroConnection.upsert({
      where: { organisationId },
      create: { organisationId, ...data },
      update: data,
    });
  } catch {
    throw new XeroTenantConflict();
  }
};

export const savePendingTenantSelection = async (
  context: APIContext,
  attemptId: string,
  tenants: XeroTenant[],
  tokens: Required<Pick<XeroTokenResponse, 'access_token' | 'refresh_token' | 'expires_in'>> & XeroTokenResponse,
) => {
  const config = getXeroConfig();
  const selectionToken = createOpaqueValue();
  await prisma.xeroOAuthState.update({
    where: { id: attemptId },
    data: {
      selectionTokenHash: hashOpaqueValue(selectionToken),
      selectionExpiresAt: new Date(Date.now() + OAUTH_TTL_MS),
      pendingAccessTokenEncrypted: encryptToken(tokens.access_token, config.encryptionKey),
      pendingRefreshTokenEncrypted: encryptToken(tokens.refresh_token, config.encryptionKey),
      pendingAccessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      pendingGrantedScopes: tokens.scope ?? XERO_SCOPES.join(' '),
      pendingTenants: tenants,
    },
  });
  context.cookies.set(XERO_SELECTION_COOKIE, selectionToken, secureCookie());
};

export const getPendingTenantSelection = async (context: APIContext, organisationId: string, userId: string) => {
  const selectionToken = context.cookies.get(XERO_SELECTION_COOKIE)?.value;
  if (!selectionToken) throw new XeroOAuthStateInvalid();
  const attempt = await prisma.xeroOAuthState.findFirst({
    where: {
      organisationId,
      userId,
      selectionTokenHash: hashOpaqueValue(selectionToken),
      selectionExpiresAt: { gt: new Date() },
    },
  });
  if (!attempt || !Array.isArray(attempt.pendingTenants)) throw new XeroOAuthStateInvalid();
  return { attempt, tenants: attempt.pendingTenants as XeroTenant[] };
};

export const completePendingTenantSelection = async (
  context: APIContext,
  organisationId: string,
  userId: string,
  tenantId: string,
) => {
  const { attempt, tenants } = await getPendingTenantSelection(context, organisationId, userId);
  const tenant = tenants.find((candidate) => candidate.tenantId === tenantId);
  if (!tenant || !attempt.pendingAccessTokenEncrypted || !attempt.pendingRefreshTokenEncrypted || !attempt.pendingAccessTokenExpiresAt) {
    throw new XeroTenantConflict();
  }
  const config = getXeroConfig();
  const expiresIn = Math.max(1, Math.floor((attempt.pendingAccessTokenExpiresAt.getTime() - Date.now()) / 1000));
  const connection = await connectXeroTenant(organisationId, tenant, {
    access_token: decryptToken(attempt.pendingAccessTokenEncrypted, config.encryptionKey),
    refresh_token: decryptToken(attempt.pendingRefreshTokenEncrypted, config.encryptionKey),
    expires_in: expiresIn,
    scope: attempt.pendingGrantedScopes ?? XERO_SCOPES.join(' '),
  });
  context.cookies.delete(XERO_SELECTION_COOKIE, { path: '/' });
  await prisma.xeroOAuthState.delete({ where: { id: attempt.id } });
  return connection;
};

export const disconnectXeroOrganisation = async (organisationId: string) => {
  const connection = await prisma.xeroConnection.findUnique({ where: { organisationId } });
  if (!connection) return;
  const accessToken = await getValidXeroAccessToken(connection);
  const response = await fetch(`${XERO_CONNECTIONS_URL}/${encodeURIComponent(connection.xeroConnectionId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok && response.status !== 404 && response.status !== 401) {
    throw new HttpError(502, 'Xero could not be disconnected. Please try again.');
  }
  await prisma.$transaction([
    prisma.xeroConnection.delete({ where: { id: connection.id } }),
    prisma.xeroOAuthState.deleteMany({ where: { organisationId } }),
  ]);
};
