import type { XeroConnection } from '@prisma/client';
import { XeroRateLimited, XeroReconnectRequired } from '@/lib/xero/errors';
import { getValidXeroAccessToken } from '@/lib/xero/token';
import { HttpError } from '@/lib/utils/http';

const XERO_ACCOUNTING_API = 'https://api.xero.com/api.xro/2.0';

export const xeroRequestWithAccessToken = async <T>(
  accessToken: string,
  tenantId: string,
  path: string,
  init: RequestInit = {},
) => {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${accessToken}`);
  headers.set('xero-tenant-id', tenantId);
  headers.set('accept', 'application/json');
  const response = await fetch(`${XERO_ACCOUNTING_API}${path}`, { ...init, method: init.method ?? 'GET', headers });
  if (response.status === 304) return {} as T;
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new XeroRateLimited(Number.isFinite(retryAfter) ? retryAfter : undefined);
  }
  if (response.status === 401) throw new XeroReconnectRequired();
  if (!response.ok) throw new HttpError(502, `Xero request failed (${response.status}).`);
  return response.json() as Promise<T>;
};

export const xeroGet = async <T>(connection: XeroConnection, path: string, headers?: HeadersInit) => {
  const accessToken = await getValidXeroAccessToken(connection);
  return xeroRequestWithAccessToken<T>(accessToken, connection.xeroTenantId, path, { headers });
};
