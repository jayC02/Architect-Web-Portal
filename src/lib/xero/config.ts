import { absoluteUrl } from '@/lib/config';
import { HttpError } from '@/lib/utils/http';

export const XERO_AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';
export const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
export const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';
export const xeroBasicAuthorization = (clientId: string, clientSecret: string) =>
  `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;

export const XERO_READ_SCOPES = [
  'offline_access',
  'accounting.contacts.read',
  'accounting.invoices.read',
  'accounting.payments.read',
  'accounting.reports.profitandloss.read',
  'accounting.reports.aged.read',
  'accounting.settings.read',
] as const;

// Kept as the read-only default so existing connections are never silently
// upgraded. Xero's granular invoices scope is requested only when an owner or
// admin explicitly enables draft creation.
export const XERO_SCOPES = XERO_READ_SCOPES;
export const XERO_DRAFT_SCOPES = [...XERO_READ_SCOPES, 'accounting.invoices'] as const;
export const hasXeroDraftInvoiceScope = (grantedScopes: string | null | undefined) =>
  new Set(String(grantedScopes ?? '').split(/\s+/).filter(Boolean)).has('accounting.invoices');

const requiredEnvironmentValue = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new HttpError(503, 'Xero is not configured on this server.');
  return value;
};

const readEncryptionKey = () => {
  const encoded = requiredEnvironmentValue('XERO_TOKEN_ENCRYPTION_KEY');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new HttpError(503, 'Xero token encryption is not configured correctly.');
  return key;
};

export const getXeroConfig = () => ({
  clientId: requiredEnvironmentValue('XERO_CLIENT_ID'),
  clientSecret: requiredEnvironmentValue('XERO_CLIENT_SECRET'),
  redirectUri: process.env.XERO_REDIRECT_URI?.trim() || absoluteUrl('/api/integrations/xero/callback'),
  encryptionKey: readEncryptionKey(),
});

export const getXeroConfigurationStatus = () => ({
  configured: Boolean(
    process.env.XERO_CLIENT_ID?.trim()
    && process.env.XERO_CLIENT_SECRET?.trim()
    && process.env.XERO_TOKEN_ENCRYPTION_KEY?.trim()
    && (process.env.XERO_REDIRECT_URI?.trim() || process.env.PUBLIC_SITE_URL?.trim()),
  ),
});
