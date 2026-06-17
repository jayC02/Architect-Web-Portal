export const prerender = false;

import type { APIRoute } from 'astro';
import { destroySession } from '@/lib/auth/session';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    await destroySession(context);
    return jsonResponse(200, { ok: true });
  }, context);