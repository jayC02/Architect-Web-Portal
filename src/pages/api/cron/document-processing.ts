export const prerender = false;
import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { jsonResponse } from '@/lib/utils/http';
import { runDocumentProcessingWorker } from '@/server/services/document-processing.service';
export const GET: APIRoute = async ({ request }) => {
  const expected = Buffer.from(process.env.CRON_SECRET?.trim() ?? '');
  const actual = Buffer.from(request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
  if (!expected.length || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return jsonResponse(401, { error: 'Unauthorised scheduled request.' });
  try { return jsonResponse(200, await runDocumentProcessingWorker()); }
  catch { console.info('document-processing-sweep', { state: 'failed' }); return jsonResponse(503, { error: 'Processing sweep could not complete. Recovery will retry.' }); }
};
