export const prerender = false;

import type { APIRoute } from 'astro';
import {
  connectGoogleCalendar,
  exchangeGoogleAuthorizationCode,
  googleCalendarOAuthCookie,
  syncAllGoogleDeadlines,
  verifyGoogleOAuthCallbackState,
} from '@/lib/integrations/google-calendar';
import { requireOrganisationRole } from '@/server/permissions/authz';

const integrationRedirect = (context: Parameters<APIRoute>[0], status: 'connected' | 'error', message?: string) => {
  const url = new URL('/settings/integrations', context.url.origin);
  url.searchParams.set('google', status);
  if (message) url.searchParams.set('message', message.slice(0, 180));
  return context.redirect(url.toString());
};

export const GET: APIRoute = async (context) => {
  try {
    const auth = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
    const providerError = context.url.searchParams.get('error');
    if (providerError) return integrationRedirect(context, 'error', 'Google Calendar connection was cancelled.');
    const code = context.url.searchParams.get('code');
    const state = context.url.searchParams.get('state');
    const cookieNonce = context.cookies.get(googleCalendarOAuthCookie)?.value;
    if (!code || !state || !cookieNonce) return integrationRedirect(context, 'error', 'Google Calendar connection could not be verified.');
    const verified = verifyGoogleOAuthCallbackState(state);
    if (
      verified.organisationId !== auth.organisation.id
      || verified.userId !== auth.user.id
      || verified.nonce !== cookieNonce
    ) {
      return integrationRedirect(context, 'error', 'Google Calendar connection could not be verified.');
    }
    context.cookies.delete(googleCalendarOAuthCookie, { path: '/api/integrations/google-calendar' });
    const tokens = await exchangeGoogleAuthorizationCode(code);
    await connectGoogleCalendar(auth.organisation.id, tokens);
    await syncAllGoogleDeadlines(auth.organisation.id);
    return integrationRedirect(context, 'connected');
  } catch (error) {
    console.error('Google Calendar OAuth callback failed', error);
    const message = error instanceof Error ? error.message : 'Google Calendar connection failed.';
    return integrationRedirect(context, 'error', message);
  }
};
