export const prerender = false;

import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { APIRoute } from 'astro';
import { getSessionAuth } from '@/lib/auth/session';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError } from '@/lib/utils/http';
import { requireAgentAuth } from '@/server/auth/agent-credential';
import { assertEntitled } from '@/server/billing/access';
import { resolveReleaseLocation } from '@/server/billing/release-storage';
import { agentReleaseMetadata, agentReleaseStorageKeys } from '@/server/services/agent-release.service';

// Gated installer download. Allowed for a signed-in member of an entitled
// workspace (browser) or an enrolled Agent of one (self-update, sending its
// bearer credential). Redirects to a 5-minute signed URL; never cached.
export const GET: APIRoute = (context) => withErrorHandling(async () => {
  const headers = { 'Cache-Control': 'no-store' };
  if (context.request.headers.get('authorization')) {
    await requireAgentAuth(context);
  } else {
    const auth = await getSessionAuth(context);
    if (!auth) {
      const returnTo = `${context.url.pathname}${context.url.search}`;
      return new Response(null, { status: 302, headers: { ...headers, Location: `/login?returnTo=${encodeURIComponent(returnTo)}` } });
    }
    try {
      assertEntitled(auth.organisation.subscription);
    } catch {
      return new Response(null, { status: 302, headers: { ...headers, Location: '/billing' } });
    }
  }

  const release = agentReleaseMetadata();
  if (release.status !== 'AVAILABLE') throw new HttpError(503, 'The Agent update is being prepared. Please try again shortly.');
  const keys = agentReleaseStorageKeys(release.version);
  const source = context.url.searchParams.get('artifact') === 'source';
  const storageKey = source ? keys.source : keys.installer;
  const location = await resolveReleaseLocation(storageKey, storageKey);
  if (location.kind === 'redirect') {
    return new Response(null, { status: 302, headers: { ...headers, Location: location.url } });
  }
  let size: number;
  try { size = statSync(location.path).size; } catch { throw new HttpError(404, 'This Agent release is not available locally.'); }
  return new Response(Readable.toWeb(createReadStream(location.path)) as ReadableStream, {
    status: 200,
    headers: {
      ...headers,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${storageKey}"`,
    },
  });
}, context);
