export const prerender = false;

import type { APIRoute } from 'astro';
import { agentReleaseMetadata } from '@/server/services/agent-release.service';

// One public link can be shared for every release. Never cache its redirect,
// otherwise a browser or CDN could keep sending clients to an older installer.
export const GET: APIRoute = () => {
  const release = agentReleaseMetadata();
  const headers = { 'Cache-Control': 'no-store' };
  if (release.status !== 'AVAILABLE'
    || !/^\/downloads\/ArchitectProAgentSetup-\d+\.\d+\.\d+\.exe$/.test(release.downloadUrl)) {
    return new Response('The Agent update is being prepared. Please try again shortly.', {
      status: 503,
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(null, { status: 302, headers: { ...headers, Location: release.downloadUrl } });
};
