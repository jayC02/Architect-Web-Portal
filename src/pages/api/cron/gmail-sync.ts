export const prerender = false;

import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import { jsonResponse } from '@/lib/utils/http';
import { syncAllEnabledGmailConnections } from '@/server/services/gmail-sync.service';

const authorised = (request: Request) => {
  const secret = process.env.CRON_SECRET?.trim();
  const submitted = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || !submitted) return false;
  const expectedBuffer = Buffer.from(secret);
  const submittedBuffer = Buffer.from(submitted);
  return expectedBuffer.length === submittedBuffer.length && crypto.timingSafeEqual(expectedBuffer, submittedBuffer);
};

export const GET: APIRoute = async ({ request }) => {
  if (!authorised(request)) return jsonResponse(401, { error: 'Unauthorised scheduled request.' });
  if (process.env.GMAIL_SCHEDULED_SYNC_ENABLED?.trim().toLowerCase() === 'false') {
    return jsonResponse(200, { ok: true, skipped: true });
  }
  const results = await syncAllEnabledGmailConnections();
  return jsonResponse(200, {
    ok: true,
    organisations: results.length,
    succeeded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
  });
};
