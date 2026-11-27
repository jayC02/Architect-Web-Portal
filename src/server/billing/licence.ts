import crypto from 'node:crypto';
import { HttpError } from '@/lib/utils/http';
import type { Entitlement } from '@/server/billing/entitlement';

// Short-lived, signed Agent licences (EdDSA / Ed25519 JWTs).
//
// The Agent embeds the public key, verifies every licence offline and refuses
// to automate without a valid one. Because licences expire after 72 hours and
// are only re-issued to an enrolled, un-revoked Agent of a paid-up
// organisation, a copied installer or a cancelled customer's Agent stops
// working on its own, even if it never reaches our API again.

export const LICENCE_ISSUER = 'architect-pro';
export const LICENCE_AUDIENCE = 'architect-pro-agent';
export const LICENCE_TTL_SECONDS = 72 * 60 * 60;
export const LICENCE_REFRESH_SECONDS = 12 * 60 * 60;

export type AgentLicenceClaims = {
  iss: string;
  aud: string;
  sub: string; // Agent registration id
  org: string;
  inst: string; // installation id
  plan: string | null;
  status: string;
  dev: number; // Agent computer limit for the organisation
  iat: number;
  nbf: number;
  exp: number;
  rfa: number; // refresh after
  jti: string;
};

const b64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

const readKey = (raw: string | undefined, kind: 'private' | 'public') => {
  const value = raw?.trim();
  if (!value) return null;
  const pem = value.includes('-----BEGIN') ? value.replace(/\\n/g, '\n') : Buffer.from(value, 'base64').toString('utf8');
  return kind === 'private' ? crypto.createPrivateKey(pem) : crypto.createPublicKey(pem);
};

export const licenceKeyId = () => process.env.LICENCE_KEY_ID?.trim() || 'v1';

const signingKey = () => {
  const key = readKey(process.env.LICENCE_SIGNING_PRIVATE_KEY, 'private');
  if (!key) throw new HttpError(503, 'Agent licensing is not configured.');
  return key;
};

export const buildLicenceClaims = (input: {
  agent: { id: string; organisationId: string; installationId: string };
  subscription: { plan?: string | null; agentDeviceLimit?: number | null } | null;
  entitlement: Entitlement;
  now?: Date;
}): AgentLicenceClaims => {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  let exp = nowSeconds + LICENCE_TTL_SECONDS;
  // Never let an offline licence outlive the access it represents (e.g. a trial).
  if (input.entitlement.accessEndsAt) exp = Math.min(exp, Math.floor(input.entitlement.accessEndsAt.getTime() / 1000));
  return {
    iss: LICENCE_ISSUER,
    aud: LICENCE_AUDIENCE,
    sub: input.agent.id,
    org: input.agent.organisationId,
    inst: input.agent.installationId,
    plan: input.subscription?.plan ?? null,
    status: input.entitlement.status,
    dev: input.subscription?.agentDeviceLimit ?? 1,
    iat: nowSeconds,
    nbf: nowSeconds - 60,
    exp,
    rfa: Math.min(exp, nowSeconds + LICENCE_REFRESH_SECONDS),
    jti: crypto.randomUUID(),
  };
};

export const signLicence = (claims: AgentLicenceClaims, privateKey: crypto.KeyObject = signingKey(), kid = licenceKeyId()) => {
  const header = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid }));
  const payload = b64url(JSON.stringify(claims));
  const signature = crypto.sign(null, Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
};

// Reference verifier (the Agent implements the same checks in Python).
export const verifyLicence = (
  token: string,
  publicKey: crypto.KeyObject,
  expected: { sub?: string; inst?: string; now?: Date } = {},
): AgentLicenceClaims => {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) throw new Error('Malformed licence.');
  const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  if (parsedHeader.alg !== 'EdDSA') throw new Error('Unexpected licence algorithm.');
  const valid = crypto.verify(null, Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url'));
  if (!valid) throw new Error('Licence signature is invalid.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AgentLicenceClaims;
  const now = Math.floor((expected.now ?? new Date()).getTime() / 1000);
  if (claims.iss !== LICENCE_ISSUER || claims.aud !== LICENCE_AUDIENCE) throw new Error('Licence was not issued for this Agent.');
  if (claims.nbf > now || claims.exp <= now) throw new Error('Licence has expired.');
  if (expected.sub && claims.sub !== expected.sub) throw new Error('Licence belongs to another Agent.');
  if (expected.inst && claims.inst !== expected.inst) throw new Error('Licence belongs to another installation.');
  return claims;
};

export const licencePublicKeyPem = () => {
  const key = readKey(process.env.LICENCE_SIGNING_PRIVATE_KEY, 'private');
  return key ? crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString() : null;
};
