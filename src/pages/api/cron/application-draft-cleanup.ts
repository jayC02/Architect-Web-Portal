export const prerender = false;

import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import { jsonResponse } from '@/lib/utils/http';
import { cleanupExpiredApplicationDraftsForAllOrganisations } from '@/server/services/application-draft-files.service';

// Daily: marks unfinished application drafts older than 7 days as expired, deletes their
// temporary files, and removes uploads that were never finalised.

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
  const result = await cleanupExpiredApplicationDraftsForAllOrganisations();
  return jsonResponse(200, { ok: true, ...result });
};
