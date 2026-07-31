export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.upload, 'application-drafts:add-documents');
    await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Application draft id is required.');
    throw new HttpError(410, 'Upload documents directly using an upload intent.');
  }, context);
