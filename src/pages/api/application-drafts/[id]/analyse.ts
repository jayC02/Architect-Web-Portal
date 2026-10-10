export const prerender = false;

import { ApplicationDraftStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import {
  analyseApplicationDraft,
  getApplicationDraftForOrganisation,
} from '@/server/services/application-draft.service';
import { applicationDraftResponse } from '@/server/services/application-draft-view.service';

const inputSchema = z.object({ force: z.boolean().default(false) }).strict();

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.upload, 'application-drafts:analyse');
    const { organisation } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Application draft id is required.');
    const input = await parseBody(context.request, inputSchema);
    await getApplicationDraftForOrganisation(id, organisation.id);
    try {
      await analyseApplicationDraft(id, organisation.id, input);
    } catch (error) {
      await prisma.applicationDraft.updateMany({
        where: {
          id,
          organisationId: organisation.id,
          status: ApplicationDraftStatus.ANALYSING,
        },
        data: {
          status: ApplicationDraftStatus.FAILED,
          analysisSummary: {
            phase: 'failed',
            completed: 0,
            total: 0,
            message: 'The application could not be prepared. Your files are safe and you can try again.',
          },
        },
      });
      throw error;
    }
    const draft = await getApplicationDraftForOrganisation(id, organisation.id);
    return jsonResponse(200, { draft: applicationDraftResponse(draft) });
  }, context);
