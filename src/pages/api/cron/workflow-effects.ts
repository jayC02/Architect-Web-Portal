export const prerender = false;

import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { jsonResponse } from '@/lib/utils/http';
import { expandUndispatchedLifecycleEvents } from '@/server/services/lifecycle-events.service';
import { drainWorkflowEffects } from '@/server/services/workflow-effects.service';

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

  const undispatched = await prisma.lifecycleEvent.findMany({
    where: { dispatchedAt: null },
    distinct: ['organisationId'],
    take: 20,
    select: { organisationId: true },
  });
  let expanded = 0;
  for (const event of undispatched) {
    expanded += await prisma.$transaction((tx) =>
      expandUndispatchedLifecycleEvents(tx, event.organisationId, 50));
  }
  const result = await drainWorkflowEffects({ limit: 25 });
  return jsonResponse(200, { ok: true, expanded, ...result });
};
