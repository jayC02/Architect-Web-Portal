import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as oauth from '../src/lib/auth/oauth';
import { assertAllowedOrigin } from '../src/lib/server/origin-guard';
import { assertRateLimit } from '../src/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '../src/lib/utils/handlers';
import { HttpError, jsonResponse } from '../src/lib/utils/http';
import { completeGoogleSignupSchema } from '../src/lib/validation/auth';
import { hashOpaqueToken, createOpaqueToken } from '../src/lib/auth/tokens';

Object.assign(process.env, { GOOGLE_AUTH_CLIENT_ID: 'fixture-client', GOOGLE_AUTH_CLIENT_SECRET: 'fixture-secret',
  GOOGLE_AUTH_REDIRECT_URI: 'https://www.architectpro.co.uk/api/auth/google/callback', AUTH_OAUTH_STATE_SECRET: 'fixture-state-secret-at-least-thirty-two-characters' });
const origin = 'https://www.architectpro.co.uk';
function route(file: string, modules: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, require: (name: string) => { assert.ok(name in modules, `Unexpected route dependency ${name}`); return modules[name]; },
    console, Date, Request, Response, URL, Buffer, process });
  return exports;
}
function context(path = '/api/auth/google/callback') {
  const cookies = new Map<string, string>();
  return { url: new URL(origin + path), request: new Request(origin + path, { headers: { origin } }), cookies: {
    get: (key: string) => cookies.has(key) ? { value: cookies.get(key)! } : undefined,
    set: (key: string, value: string) => cookies.set(key, value), delete: (key: string) => cookies.delete(key),
  }, redirect: (value: string) => new Response(null, { status: 302, headers: { location: value } }) } as any;
}
function callbackHarness(options: { passwordHash?: string | null; linkedUserId?: string; connect?: boolean; sessionUserId?: string | null; sessionEmail?: string } = {}) {
  const writes: any[] = [], sessions: string[] = [];
  const profile = { accountId: 'google-fixture', email: 'account@example.test', displayName: 'Fixture Account', avatarUrl: null };
  const db = { authProvider: {
    findUnique: async () => options.linkedUserId ? { userId: options.linkedUserId } : null,
    create: async (input: any) => { writes.push(input); return {}; }, upsert: async (input: any) => { writes.push(input); return {}; },
  }, user: { findUnique: async () => ({ id: 'user-fixture', passwordHash: options.passwordHash ?? null }) }, pendingOAuthSignup: { upsert: async (input: any) => { writes.push(input); return {}; } } };
  const modules = { '@/lib/auth/oauth': oauth,
    '@/lib/auth/session': { createSession: async (id: string) => sessions.push(id), getSessionUser: async () => options.sessionUserId === null ? null : { id: options.sessionUserId ?? 'user-fixture', email: options.sessionEmail ?? profile.email } },
    '@/lib/auth/tokens': { hashOpaqueToken, createOpaqueToken }, '@/lib/db/prisma': { prisma: db },
    '@/lib/server/rate-limit': { assertRateLimit: () => {}, rateLimitPolicies: { oauth: {} } },
    '@/server/services/google-auth.service': { exchangeGoogleCode: async () => profile },
  };
  const handler = route('src/pages/api/auth/google/callback.ts', modules).GET;
  const ctx = context();
  const auth = new URL(oauth.createGoogleAuthorizationUrl(ctx, '/dashboard', options.connect ? 'user-fixture' : undefined));
  ctx.url.searchParams.set('code', 'fixture-code'); ctx.url.searchParams.set('state', auth.searchParams.get('state')!);
  return { ctx, writes, sessions, run: () => handler(ctx) };
}

const password = callbackHarness({ passwordHash: 'fixture-password-hash' });
assert.equal((await password.run()).headers.get('location'), '/login?authError=google_password_required');
assert.deepEqual(password.writes, []); assert.deepEqual(password.sessions, [], 'Google cannot auto-link or sign into an unlinked password account');
const passwordless = callbackHarness();
assert.equal((await passwordless.run()).headers.get('location'), '/dashboard');
assert.equal(passwordless.writes[0].create.userId, 'user-fixture');
assert.deepEqual(passwordless.sessions, ['user-fixture']);
const alreadyLinked = callbackHarness({ passwordHash: 'fixture-hash', linkedUserId: 'user-fixture' });
assert.equal((await alreadyLinked.run()).headers.get('location'), '/dashboard');
assert.deepEqual(alreadyLinked.writes, [], 'an explicitly linked provider can still sign in');
const connect = callbackHarness({ connect: true, passwordHash: 'fixture-hash' });
assert.equal((await connect.run()).headers.get('location'), '/settings/preferences?google=connected');
assert.equal(connect.writes[0].data.userId, 'user-fixture');
assert.deepEqual(connect.sessions, [], 'connecting does not switch the existing session');
for (const options of [{ sessionUserId: null }, { sessionUserId: 'other-user' }, { sessionEmail: 'different@example.test' }]) {
  const mismatch = callbackHarness({ connect: true, ...options });
  assert.equal((await mismatch.run()).headers.get('location'), '/settings/preferences?google=account_mismatch');
  assert.deepEqual(mismatch.writes, []); assert.deepEqual(mismatch.sessions, []);
}
const occupied = callbackHarness({ connect: true, linkedUserId: 'other-user' });
assert.equal((await occupied.run()).headers.get('location'), '/settings/preferences?google=already_connected');
assert.deepEqual(occupied.writes, []);
const swappedNonce = callbackHarness({ connect: true });
swappedNonce.ctx.cookies.set('architect_google_oauth_connect', JSON.stringify({ userId: 'user-fixture', nonce: 'wrong-nonce' }));
assert.equal((await swappedNonce.run()).headers.get('location'), '/login?authError=google_failed');
assert.deepEqual(swappedNonce.writes, []);

const common = { '@/lib/auth/oauth': oauth, '@/lib/server/origin-guard': { assertAllowedOrigin },
  '@/lib/server/rate-limit': { assertRateLimit: () => {}, rateLimitPolicies: { oauth: {} } },
  '@/lib/utils/handlers': { withErrorHandling, parseBody }, '@/lib/utils/http': { HttpError, jsonResponse } };
for (const signedIn of [false, true]) {
  const handler = route('src/pages/api/auth/google/connect.ts', { ...common, '@/lib/auth/session': { getSessionUser: async () => signedIn ? { id: 'user-fixture' } : null } }).POST;
  const ctx = context('/api/auth/google/connect');
  ctx.request = new Request(ctx.url, { method: 'POST', headers: { origin } });
  const response = await handler(ctx);
  assert.equal(response.status, signedIn ? 200 : 401);
  if (signedIn) {
    const payload = await response.json();
    assert.equal(new URL(payload.redirectTo).origin, 'https://accounts.google.com');
    assert.equal(oauth.consumeGoogleOAuthCookies(ctx, new URL(payload.redirectTo).searchParams.get('state')!).connectUserId, 'user-fixture');
  }
}
const signupWrites: any[] = [];
const tx = { authProvider: { findUnique: async () => null, create: async (value: any) => signupWrites.push(value) },
  user: { findUnique: async () => ({ id: 'password-user', passwordHash: 'fixture-hash' }) }, pendingOAuthSignup: { delete: async () => {} } };
const complete = route('src/pages/api/auth/google/complete.ts', { ...common,
  '@/lib/auth/organisation': { resolveOrganisationSlug: async () => 'fixture-practice' },
  '@/lib/auth/session': { createSession: async (id: string) => signupWrites.push(id) },
  '@/lib/auth/tokens': { hashOpaqueToken }, '@/lib/validation/auth': { completeGoogleSignupSchema },
  '@/lib/db/prisma': { prisma: { pendingOAuthSignup: { findUnique: async () => ({ id: 'pending', provider: 'GOOGLE', providerAccountId: 'google-fixture', email: 'account@example.test', expiresAt: new Date(Date.now() + 60_000) }) }, $transaction: async (fn: any) => fn(tx) } },
}).POST;
const completeContext = context('/api/auth/google/complete');
completeContext.cookies.set(oauth.GOOGLE_SIGNUP_COOKIE, 'fixture-pending-token');
completeContext.request = new Request(completeContext.url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ organisationName: 'Fixture Practice' }) });
assert.equal((await complete(completeContext)).status, 409);
assert.deepEqual(signupWrites, [], 'a password account created during Google sign-up cannot be linked by the completion race');

const policy = { name: 'prelaunch-ip-fixture', windowMs: 60_000, max: 1 };
const rateContext = (cf: string) => ({ request: new Request(origin, { headers: { 'x-forwarded-for': '192.0.2.121', 'cf-connecting-ip': cf } }), clientAddress: '192.0.2.122' }) as any;
assertRateLimit(rateContext('192.0.2.1'), policy, 'rotating-cf');
assert.throws(() => assertRateLimit(rateContext('192.0.2.2'), policy, 'rotating-cf'), (error: any) => error.status === 429);
console.log('Pre-launch security: password-account linking, authenticated nonce-bound Google connection, signup race and spoofed-IP rate limiting passed.');
