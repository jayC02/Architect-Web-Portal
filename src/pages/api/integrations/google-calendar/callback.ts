export const prerender = false;

import type { APIRoute } from 'astro';
import { absoluteUrl } from '@/lib/config';
import {
  connectGoogleCalendar,
  exchangeGoogleAuthorizationCode,
  googleConnectionHasGmailScope,
  syncAllGoogleDeadlines,
  verifyGoogleOAuthCallbackState,
} from '@/lib/integrations/google-calendar';
import { prisma } from '@/lib/db/prisma';
import { requireOrganisationRole } from '@/server/permissions/authz';

const integrationRedirect = (
  context: Parameters<APIRoute>[0],
  status: 'connected' | 'error',
  message?: string,
  capability: 'calendar' | 'gmail' = 'calendar',
) => {
  const url = new URL(absoluteUrl('/settings/integrations'));
  url.searchParams.set(capability === 'gmail' ? 'gmail' : 'google', status);
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
    if (!code || !state) return integrationRedirect(context, 'error', 'Google Calendar connection could not be verified.');
    const verified = verifyGoogleOAuthCallbackState(state);
    if (
      verified.organisationId !== auth.organisation.id
      || verified.userId !== auth.user.id
    ) {
      return integrationRedirect(context, 'error', 'Google Calendar connection could not be verified.');
    }
    const tokens = await exchangeGoogleAuthorizationCode(code);
    const connection = await connectGoogleCalendar(auth.organisation.id, tokens);
    if (verified.capability === 'gmail') {
      if (!googleConnectionHasGmailScope(connection)) {
        return integrationRedirect(context, 'error', 'Google did not grant Gmail read access.', 'gmail');
      }
      await prisma.calendarConnection.update({
        where: { id: connection.id },
        data: { gmailEnabled: true, gmailSyncError: null },
      });
    }
    await syncAllGoogleDeadlines(auth.organisation.id);
    return integrationRedirect(context, 'connected', undefined, verified.capability === 'gmail' ? 'gmail' : 'calendar');
  } catch (error) {
    console.error('Google Calendar OAuth callback failed', error);
    const message = error instanceof Error ? error.message : 'Google Calendar connection failed.';
    return integrationRedirect(context, 'error', message);
  }
};
