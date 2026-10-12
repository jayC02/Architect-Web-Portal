import crypto from 'node:crypto';
import type { APIContext } from 'astro';
import { HttpError } from '@/lib/utils/http';

type RateLimitPolicy = {
  name: string;
  windowMs: number;
  max: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

const hashKey = (value: string) => crypto.createHash('sha256').update(value).digest('base64url');
const firstHeaderValue = (value: string | null) => value?.split(',')[0]?.trim() || null;

const getClientIp = (context: APIContext) =>
  firstHeaderValue(context.request.headers.get('cf-connecting-ip')) ??
  firstHeaderValue(context.request.headers.get('x-forwarded-for')) ??
  firstHeaderValue(context.request.headers.get('x-real-ip')) ??
  context.clientAddress ??
  'unknown';

const pruneExpiredBuckets = (now: number) => {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }

  while (buckets.size > MAX_BUCKETS) {
    const next = buckets.keys().next();
    if (next.done) break;
    buckets.delete(next.value);
  }
};

export const rateLimitPolicies = {
  auth: { name: 'auth', windowMs: 15 * 60 * 1000, max: 20 },
  oauth: { name: 'oauth', windowMs: 15 * 60 * 1000, max: 30 },
  passwordReset: { name: 'password-reset', windowMs: 15 * 60 * 1000, max: 8 },
  mutation: { name: 'mutation', windowMs: 10 * 60 * 1000, max: 80 },
  upload: { name: 'upload', windowMs: 15 * 60 * 1000, max: 20 },
  desktop: { name: 'desktop', windowMs: 15 * 60 * 1000, max: 300 },
} satisfies Record<string, RateLimitPolicy>;

export const assertRateLimit = (context: APIContext, policy: RateLimitPolicy, scope = '') => {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS || Math.random() < 0.01) pruneExpiredBuckets(now);

  const key = `${policy.name}:${hashKey(`${getClientIp(context)}:${scope}`)}`;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + policy.windowMs });
    return;
  }

  existing.count += 1;
  if (existing.count > policy.max) {
    throw new HttpError(429, 'Too many requests. Please wait and try again.');
  }
};
