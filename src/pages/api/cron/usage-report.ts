export const prerender = false;

import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import { jsonResponse } from '@/lib/utils/http';
import { reportPendingUsage } from '@/server/billing/usage';

const authorised = (request: Request) => {
  const secret = process.env.CRON_SECRET?.trim();
  const submitted = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || !submitted) return false;
  const expected = Buffer.from(secret);
  const received = Buffer.from(submitted);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
};

// Retries per-application usage that couldn't be reported to Stripe straight
// after the Agent finished (Stripe outage, missing config at the time).
export const GET: APIRoute = async ({ request }) => {
  if (!authorised(request)) return jsonResponse(401, { error: 'Unauthorised scheduled request.' });
  return jsonResponse(200, { ok: true, ...(await reportPendingUsage()) });
};
