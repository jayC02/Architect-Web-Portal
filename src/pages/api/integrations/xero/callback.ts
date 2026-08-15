export const prerender = false;

import type { APIRoute } from 'astro';
import { absoluteUrl } from '@/lib/config';
import {
  connectXeroTenant,
  consumeXeroOAuthState,
  exchangeXeroAuthorizationCode,
  getAuthorisedXeroTenants,
  savePendingTenantSelection,
} from '@/lib/xero/oauth';
import { syncXeroOrganisation } from '@/lib/xero/sync';
import { requireOrganisationRole } from '@/server/permissions/authz';

const redirectToIntegrations = (context: Parameters<APIRoute>[0], status: 'connected' | 'error', message?: string) => {
  const url = new URL(absoluteUrl('/settings/integrations'));
  url.searchParams.set('xero', status);
  if (message) url.searchParams.set('message', message.slice(0, 180));
  return context.redirect(url.toString());
};

export const GET: APIRoute = async (context) => {
  try {
    const { organisation, user } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
    if (context.url.searchParams.get('error')) return redirectToIntegrations(context, 'error', 'Xero connection was cancelled.');
    const code = context.url.searchParams.get('code');
    const state = context.url.searchParams.get('state');
    if (!code || !state) return redirectToIntegrations(context, 'error', 'The Xero connection could not be verified.');
    const attempt = await consumeXeroOAuthState(state, organisation.id, user.id);
    const tokens = await exchangeXeroAuthorizationCode(code);
    const tenants = await getAuthorisedXeroTenants(tokens.access_token);
    if (!tenants.length) return redirectToIntegrations(context, 'error', 'No Xero organisation was authorised.');
    if (tenants.length > 1) {
      await savePendingTenantSelection(context, attempt.id, tenants, tokens);
      return context.redirect(absoluteUrl('/settings/integrations/xero/select'));
    }
    await connectXeroTenant(organisation.id, tenants[0], tokens);
    await syncXeroOrganisation(organisation.id).catch(() => undefined);
    return redirectToIntegrations(context, 'connected');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Xero connection failed.';
    return redirectToIntegrations(context, 'error', message);
  }
};
