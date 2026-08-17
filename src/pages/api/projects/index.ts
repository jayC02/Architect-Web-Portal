export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { projectCreateSchema } from '@/lib/validation/domain';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { withPerf } from '@/lib/utils/perf';
import { requireOrganisation } from '@/server/permissions/authz';
import { createProjectWithLifecycle } from '@/server/services/project-creation.service';
import { resolveProjectLinks } from '@/server/services/project-data.service';
import { drainWorkflowEffectsBestEffort } from '@/server/services/workflow-effects.service';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const projects = await withPerf('api.projects.list', () =>
      prisma.project.findMany({
        where: { organisationId: organisation.id },
        select: {
          id: true,
          name: true,
          internalReference: true,
          stage: true,
          status: true,
          localAuthority: true,
          updatedAt: true,
          client: { select: { name: true } },
          site: { select: { addressLine1: true, postcode: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
    );
    return jsonResponse(200, { projects });
  }, context);

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.mutation, 'projects:create');
    const { organisation, user } = await requireOrganisation(context);
    const body = await parseBody(context.request, projectCreateSchema);
    const links = await resolveProjectLinks(organisation.id, body.clientId, body.siteId);
    const name = body.name?.trim() || links.derivedSite?.siteAddress;
    if (!name) throw new HttpError(400, 'Choose a site or enter a project name.');
    const { project, lifecycleEventId } = await createProjectWithLifecycle({
      data: {
        ...body,
        name,
        clientId: links.clientId,
        siteId: links.siteId,
        siteAddress: links.derivedSite?.siteAddress,
        localAuthority: links.derivedSite?.localAuthority,
        organisationId: organisation.id,
      },
      actorUserId: user.id,
    });
    await drainWorkflowEffectsBestEffort({
      organisationId: organisation.id,
      lifecycleEventId,
    });
    return jsonResponse(201, { project, redirectTo: `/projects/${project.id}` });
  }, context);
