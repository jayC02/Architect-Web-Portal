import crypto from 'node:crypto';
import type { APIContext } from 'astro';
import { createOpaqueToken, safeEqual } from '@/lib/auth/tokens';

const GOOGLE_STATE_COOKIE = 'architect_google_oauth_state';
const GOOGLE_PKCE_COOKIE = 'architect_google_oauth_pkce';
export const GOOGLE_SIGNUP_COOKIE = 'architect_google_signup';
const OAUTH_TTL_MS = 10 * 60 * 1000;

type OAuthState = {
  provider: 'google';
  nonce: string;
  expiresAt: number;
};

const requiredEnv = (name: string, value: string | undefined) => {
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
};

export const getGoogleAuthConfig = () => ({
  clientId: requiredEnv(
    'GOOGLE_AUTH_CLIENT_ID',
    import.meta.env?.GOOGLE_AUTH_CLIENT_ID || process.env.GOOGLE_AUTH_CLIENT_ID,
  ),
  clientSecret: requiredEnv(
    'GOOGLE_AUTH_CLIENT_SECRET',
    import.meta.env?.GOOGLE_AUTH_CLIENT_SECRET || process.env.GOOGLE_AUTH_CLIENT_SECRET,
  ),
  redirectUri: requiredEnv(
    'GOOGLE_AUTH_REDIRECT_URI',
    import.meta.env?.GOOGLE_AUTH_REDIRECT_URI || process.env.GOOGLE_AUTH_REDIRECT_URI,
  ),
  stateSecret: requiredEnv(
    'AUTH_OAUTH_STATE_SECRET',
    import.meta.env?.AUTH_OAUTH_STATE_SECRET || process.env.AUTH_OAUTH_STATE_SECRET,
  ),
});

const signStatePayload = (payload: string, secret: string) =>
  crypto.createHmac('sha256', secret).update(payload).digest('base64url');

export const createSignedOAuthState = (nonce: string, secret: string, now = Date.now()) => {
  const payload = Buffer.from(
    JSON.stringify({ provider: 'google', nonce, expiresAt: now + OAUTH_TTL_MS } satisfies OAuthState),
  ).toString('base64url');
  return `${payload}.${signStatePayload(payload, secret)}`;
};

export const verifySignedOAuthState = (
  state: string,
  expectedNonce: string,
  secret: string,
  now = Date.now(),
) => {
  const [payload, signature, extra] = state.split('.');
  if (!payload || !signature || extra) return false;
  if (!safeEqual(signature, signStatePayload(payload, secret))) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState;
    return (
      parsed.provider === 'google' &&
      parsed.nonce === expectedNonce &&
      Number.isFinite(parsed.expiresAt) &&
      parsed.expiresAt >= now
    );
  } catch {
    return false;
  }
};

const secureCookie = () => ({
  httpOnly: true,
  secure: import.meta.env?.PROD || process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: Math.floor(OAUTH_TTL_MS / 1000),
});

export const createGoogleAuthorizationUrl = (context: APIContext) => {
  const config = getGoogleAuthConfig();
  const nonce = createOpaqueToken(24);
  const codeVerifier = createOpaqueToken(64);
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = createSignedOAuthState(nonce, config.stateSecret);

  context.cookies.set(GOOGLE_STATE_COOKIE, nonce, secureCookie());
  context.cookies.set(GOOGLE_PKCE_COOKIE, codeVerifier, secureCookie());

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
};

export const consumeGoogleOAuthCookies = (context: APIContext, state: string) => {
  const nonce = context.cookies.get(GOOGLE_STATE_COOKIE)?.value;
  const codeVerifier = context.cookies.get(GOOGLE_PKCE_COOKIE)?.value;
  context.cookies.delete(GOOGLE_STATE_COOKIE, { path: '/' });
  context.cookies.delete(GOOGLE_PKCE_COOKIE, { path: '/' });

  const { stateSecret } = getGoogleAuthConfig();
  if (!nonce || !codeVerifier || !verifySignedOAuthState(state, nonce, stateSecret)) {
    throw new Error('Google sign-in request could not be verified.');
  }
  return codeVerifier;
};

export const setPendingGoogleSignupCookie = (context: APIContext, token: string) => {
  context.cookies.set(GOOGLE_SIGNUP_COOKIE, token, secureCookie());
};

export const clearPendingGoogleSignupCookie = (context: APIContext) => {
  context.cookies.delete(GOOGLE_SIGNUP_COOKIE, { path: '/' });
};

export const oauthSignupExpiresAt = () => new Date(Date.now() + OAUTH_TTL_MS);
