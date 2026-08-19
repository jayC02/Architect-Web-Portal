export const prerender = false;

import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { syncXeroOrganisation } from '@/lib/xero/sync';
import { jsonResponse } from '@/lib/utils/http';

const authorised = (request: Request) => {
  const secret = process.env.CRON_SECRET?.trim();
  const submitted = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || !submitted) return false;
  const expected = Buffer.from(secret);
  const received = Buffer.from(submitted);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
};

export const GET: APIRoute = async ({ request }) => {
  if (!authorised(request)) return jsonResponse(401, { error: 'Unauthorised scheduled request.' });
  if (process.env.XERO_SCHEDULED_SYNC_ENABLED?.trim().toLowerCase() === 'false') return jsonResponse(200, { ok: true, skipped: true });
  const connections = await prisma.xeroConnection.findMany({
    where: { status: { notIn: ['DISCONNECTED', 'RECONNECT_REQUIRED'] } },
    select: { organisationId: true },
    take: 100,
  });
  const results = [];
  for (const connection of connections) {
    try {
      await syncXeroOrganisation(connection.organisationId);
      results.push({ organisationId: connection.organisationId, ok: true });
    } catch {
      results.push({ organisationId: connection.organisationId, ok: false });
    }
  }
  return jsonResponse(200, { ok: true, organisations: results.length, succeeded: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok).length });
};
