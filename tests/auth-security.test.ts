import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { APIContext } from 'astro';
import {
  createGoogleAuthorizationUrl,
  createSignedOAuthState,
  verifySignedOAuthState,
} from '../src/lib/auth/oauth';
import { createOpaqueToken, hashOpaqueToken } from '../src/lib/auth/tokens';
import {
  completeGoogleSignupSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../src/lib/validation/auth';
import { sendPasswordResetEmail } from '../src/server/services/email.service';
import { exchangeGoogleCode } from '../src/server/services/google-auth.service';

const secret = 'test-secret-that-is-long-enough-for-signing';
const nonce = 'browser-bound-nonce';
const now = Date.now();
const state = createSignedOAuthState(nonce, secret, now);

assert.equal(verifySignedOAuthState(state, nonce, secret, now), true);
assert.equal(verifySignedOAuthState(state, 'different-browser', secret, now), false);
assert.equal(verifySignedOAuthState(`${state}tampered`, nonce, secret, now), false);
assert.equal(verifySignedOAuthState(state, nonce, secret, now + 11 * 60 * 1000), false);

process.env.GOOGLE_AUTH_CLIENT_ID = 'architectpro-test-client';
process.env.GOOGLE_AUTH_CLIENT_SECRET = 'server-only-google-secret';
process.env.GOOGLE_AUTH_REDIRECT_URI = 'http://localhost:4321/api/auth/google/callback';
process.env.AUTH_OAUTH_STATE_SECRET = secret;
const oauthCookies = new Map<string, string>();
const oauthContext = {
  cookies: {
    set: (name: string, value: string) => oauthCookies.set(name, value),
  },
} as unknown as APIContext;
const authorizationUrl = new URL(createGoogleAuthorizationUrl(oauthContext));
assert.equal(authorizationUrl.origin, 'https://accounts.google.com');
assert.equal(authorizationUrl.searchParams.get('client_id'), 'architectpro-test-client');
assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
assert.ok(authorizationUrl.searchParams.get('code_challenge'));
assert.ok(authorizationUrl.searchParams.get('state'));
assert.equal(authorizationUrl.toString().includes('server-only-google-secret'), false);

const firstToken = createOpaqueToken();
const secondToken = createOpaqueToken();
assert.notEqual(firstToken, secondToken);
assert.notEqual(hashOpaqueToken(firstToken), firstToken);
assert.equal(hashOpaqueToken(firstToken), hashOpaqueToken(firstToken));

assert.equal(forgotPasswordSchema.parse({ email: ' USER@Example.com ' }).email, 'user@example.com');
assert.throws(() =>
  resetPasswordSchema.parse({
    token: 'a'.repeat(48),
    password: 'secure-password',
    confirmPassword: 'different-password',
  }),
);
assert.equal(
  completeGoogleSignupSchema.parse({ organisationName: '  NinetyOne Architects  ' })
    .organisationName,
  'NinetyOne Architects',
);

const root = process.cwd();
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
const loginRoute = readFileSync(resolve(root, 'src/pages/api/auth/login.ts'), 'utf8');
const forgotRoute = readFileSync(resolve(root, 'src/pages/api/auth/forgot-password.ts'), 'utf8');
const resetRoute = readFileSync(resolve(root, 'src/pages/api/auth/reset-password.ts'), 'utf8');
const callbackRoute = readFileSync(resolve(root, 'src/pages/api/auth/google/callback.ts'), 'utf8');
const googleService = readFileSync(resolve(root, 'src/server/services/google-auth.service.ts'), 'utf8');
const emailService = readFileSync(resolve(root, 'src/server/services/email.service.ts'), 'utf8');

assert.match(schema, /passwordHash String\?/);
assert.match(schema, /model AuthProvider/);
assert.match(schema, /model PasswordResetToken/);
assert.match(schema, /model PendingOAuthSignup/);
assert.match(loginRoute, /!user\?\.passwordHash/);
assert.match(forgotRoute, /GENERIC_MESSAGE/);
assert.match(forgotRoute, /assertAllowedOrigin/);
assert.match(forgotRoute, /rateLimitPolicies\.passwordReset/);
assert.match(resetRoute, /session\.deleteMany/);
assert.match(resetRoute, /expiresAt: \{ gt: new Date\(\) \}/);
assert.match(callbackRoute, /createSession/);
assert.match(callbackRoute, /pendingOAuthSignup/);
assert.match(googleService, /email_verified !== true/);
assert.match(googleService, /code_verifier/);
assert.match(emailService, /RESEND_API_KEY/);
assert.doesNotMatch(emailService, /PUBLIC_RESEND/);

const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  if (fetchCalls === 1) {
    return new Response(JSON.stringify({ access_token: 'provider-access-token' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(
    JSON.stringify({
      sub: 'google-account-123',
      email: 'verified@example.com',
      email_verified: true,
      name: 'Verified User',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};
const profile = await exchangeGoogleCode('authorization-code', 'pkce-verifier');
assert.equal(profile.accountId, 'google-account-123');
assert.equal(profile.email, 'verified@example.com');

fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  if (fetchCalls === 1) {
    return new Response(JSON.stringify({ access_token: 'provider-access-token' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(
    JSON.stringify({
      sub: 'google-account-unverified',
      email: 'unverified@example.com',
      email_verified: false,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};
await assert.rejects(() => exchangeGoogleCode('authorization-code', 'pkce-verifier'));

process.env.RESEND_API_KEY = 'server-only-resend-secret';
process.env.AUTH_EMAIL_FROM = 'ArchitectPro <accounts@example.com>';
process.env.APP_BASE_URL = 'https://architectpro.example';
let resendRequest: RequestInit | undefined;
globalThis.fetch = async (_input, init) => {
  resendRequest = init;
  return new Response(JSON.stringify({ id: 'email-123' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
await sendPasswordResetEmail('user@example.com', 'one-time-reset-token');
assert.equal(
  (resendRequest?.headers as Record<string, string>).authorization,
  'Bearer server-only-resend-secret',
);
assert.match(String(resendRequest?.body), /one-time-reset-token/);
globalThis.fetch = originalFetch;

console.log('authentication security tests passed');
