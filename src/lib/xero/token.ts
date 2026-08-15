import { XeroConnectionStatus, type XeroConnection } from '@prisma/client';
import { encryptGoogleToken as encryptToken, decryptGoogleToken as decryptToken } from '@/lib/integrations/google-calendar';
import { prisma } from '@/lib/db/prisma';
import { XERO_TOKEN_URL, getXeroConfig, xeroBasicAuthorization } from '@/lib/xero/config';
import { XeroReconnectRequired } from '@/lib/xero/errors';
import type { XeroTokenResponse } from '@/lib/xero/types';

const refreshLocks = new Map<string, Promise<string>>();

const markReconnectRequired = async (connectionId: string) => {
  await prisma.xeroConnection.updateMany({
    where: { id: connectionId },
    data: { status: XeroConnectionStatus.RECONNECT_REQUIRED, lastSyncError: 'Xero needs to be reconnected.' },
  });
};

const refreshXeroAccessToken = async (connection: XeroConnection) => {
  const config = getXeroConfig();
  const currentRefreshToken = decryptToken(connection.refreshTokenEncrypted, config.encryptionKey);
  const response = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: xeroBasicAuthorization(config.clientId, config.clientSecret),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: currentRefreshToken }),
  });
  const tokens = await response.json().catch(() => ({})) as XeroTokenResponse;
  if (!response.ok || !tokens.access_token || !tokens.refresh_token || !tokens.expires_in) {
    await markReconnectRequired(connection.id);
    throw new XeroReconnectRequired();
  }

  const encryptedAccessToken = encryptToken(tokens.access_token, config.encryptionKey);
  const encryptedRefreshToken = encryptToken(tokens.refresh_token, config.encryptionKey);
  const updated = await prisma.xeroConnection.updateMany({
    where: {
      id: connection.id,
      refreshTokenEncrypted: connection.refreshTokenEncrypted,
      status: { not: XeroConnectionStatus.DISCONNECTED },
    },
    data: {
      accessTokenEncrypted: encryptedAccessToken,
      refreshTokenEncrypted: encryptedRefreshToken,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      grantedScopes: tokens.scope ?? connection.grantedScopes,
      status: XeroConnectionStatus.CONNECTED,
      lastSyncError: null,
    },
  });
  if (updated.count === 1) return tokens.access_token;

  const current = await prisma.xeroConnection.findUnique({ where: { id: connection.id } });
  if (!current || current.status === XeroConnectionStatus.RECONNECT_REQUIRED) throw new XeroReconnectRequired();
  return decryptToken(current.accessTokenEncrypted, config.encryptionKey);
};

export const getValidXeroAccessToken = async (connection: XeroConnection) => {
  if (connection.status === XeroConnectionStatus.RECONNECT_REQUIRED || connection.status === XeroConnectionStatus.DISCONNECTED) {
    throw new XeroReconnectRequired();
  }
  const config = getXeroConfig();
  if (connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decryptToken(connection.accessTokenEncrypted, config.encryptionKey);
  }
  const existing = refreshLocks.get(connection.id);
  if (existing) return existing;
  const refreshing = refreshXeroAccessToken(connection).finally(() => refreshLocks.delete(connection.id));
  refreshLocks.set(connection.id, refreshing);
  return refreshing;
};
