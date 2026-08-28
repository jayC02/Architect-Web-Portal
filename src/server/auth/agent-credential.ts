import crypto from 'node:crypto';
import type { APIContext } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';

const AGENT_PREFIX = 'apa_';
const ENROLLMENT_PREFIX = 'ape_';
const SETUP_PREFIX = 'aps_';
const ENROLLMENT_TTL_MS = 10 * 60 * 1000;
const PKCE_GRANT_TTL_MS = 5 * 60 * 1000;
const SETUP_TTL_MS = 15 * 60 * 1000;
export const AGENT_SETUP_COOKIE = 'architect_agent_setup';

const hash = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const opaque = (prefix: string) => `${prefix}${crypto.randomBytes(36).toString('base64url')}`;

export const createAgentCredential = () => opaque(AGENT_PREFIX);
export const agentCredentialHash = hash;
export const agentCredentialPrefix = (value: string) => value.slice(0, 12);
export const createAgentEnrollmentToken = () => opaque(ENROLLMENT_PREFIX);
export const agentEnrollmentTokenHash = hash;
export const agentEnrollmentExpiry = () => new Date(Date.now() + ENROLLMENT_TTL_MS);
export const pkceAgentEnrollmentExpiry = () => new Date(Date.now() + PKCE_GRANT_TTL_MS);
export const createAgentSetupIntentToken = () => opaque(SETUP_PREFIX);
export const agentSetupIntentTokenHash = hash;
export const agentSetupIntentExpiry = () => new Date(Date.now() + SETUP_TTL_MS);

export const setAgentSetupCookie = (context: APIContext, token: string) => {
  context.cookies.set(AGENT_SETUP_COOKIE, token, {
    httpOnly: true,
    secure: import.meta.env?.PROD || process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SETUP_TTL_MS / 1000),
  });
};

export const clearAgentSetupCookie = (context: APIContext) => {
  context.cookies.delete(AGENT_SETUP_COOKIE, { path: '/' });
};

export const verifyPkceChallenge = (verifier: string, expectedChallenge: string) => {
  const actual = crypto.createHash('sha256').update(verifier, 'utf8').digest('base64url');
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expectedChallenge);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};

export const requireAgentAuth = async (context: APIContext) => {
  const authorization = context.request.headers.get('authorization') ?? '';
  const [scheme, token] = authorization.split(' ', 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token?.startsWith(AGENT_PREFIX)) {
    throw new HttpError(401, 'Architect Pro Agent authentication required.');
  }
  const agent = await prisma.agentRegistration.findUnique({
    where: { credentialHash: hash(token) },
  });
  if (!agent || !agent.enabled || agent.revokedAt) {
    throw new HttpError(401, 'This Architect Pro Agent has been revoked or is not registered.');
  }
  return agent;
};
