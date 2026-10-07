export const prerender = false;
import type { APIRoute } from 'astro';
import { jsonResponse } from '@/lib/utils/http';
import { agentReleaseMetadata } from '@/server/services/agent-release.service';

// Public distribution metadata only; it grants no Agent or application access.
export const GET: APIRoute = () => jsonResponse(200, agentReleaseMetadata());
