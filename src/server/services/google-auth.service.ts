import { getGoogleAuthConfig } from '@/lib/auth/oauth';

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
};

type GoogleProfileResponse = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

export type VerifiedGoogleProfile = {
  accountId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
};

export const exchangeGoogleCode = async (
  code: string,
  codeVerifier: string,
): Promise<VerifiedGoogleProfile> => {
  const config = getGoogleAuthConfig();
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
    }),
  });
  const tokenPayload = (await tokenResponse.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw new Error('Google token exchange failed.');
  }

  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${tokenPayload.access_token}` },
  });
  const profile = (await profileResponse.json().catch(() => ({}))) as GoogleProfileResponse;
  if (
    !profileResponse.ok ||
    !profile.sub ||
    !profile.email ||
    profile.email_verified !== true
  ) {
    throw new Error('Google account email could not be verified.');
  }

  return {
    accountId: profile.sub,
    email: profile.email.trim().toLowerCase(),
    displayName: profile.name?.trim() || profile.email.split('@')[0] || 'ArchitectPro user',
    avatarUrl: profile.picture || null,
  };
};
