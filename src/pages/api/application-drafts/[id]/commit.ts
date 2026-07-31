export const prerender = false;

import type { APIRoute } from 'astro';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { applicationDraftCommitSchema } from '@/lib/validation/application-draft';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { commitApplicationDraft } from '@/server/services/application-draft-commit.service';

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'application-drafts:commit');
    const { organisation, user } = await requireOrganisation(context);
    const id = context.params.id;
    if (!id) throw new HttpError(400, 'Application draft id is required.');
    const input = await parseBody(context.request, applicationDraftCommitSchema);
    const result = await commitApplicationDraft(
      id,
      { id: organisation.id, name: organisation.name },
      { id: user.id, name: user.name, email: user.email },
      input.review,
    );
    const applicationSection = result.warrantId ? 'building-warrant' : 'planning';
    return jsonResponse(result.created ? 201 : 200, {
      ...result,
      redirectTo: `/projects/${encodeURIComponent(result.projectId)}?applicationPrepared=1&job=${encodeURIComponent(result.automationJobId)}#${applicationSection}`,
    });
  }, context);
