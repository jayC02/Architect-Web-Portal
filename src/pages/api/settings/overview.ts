export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';
import { getWorkflowTargets } from '@/server/services/workflow-targets.service';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation, membership } = await requireOrganisation(context);
    const [defaults, certifierPresets, workflowTargets] = await Promise.all([
      prisma.organisationDefaults.findUnique({ where: { organisationId: organisation.id } }),
      prisma.organisationCertifierPreset.findMany({
        where: { organisationId: organisation.id },
        orderBy: [{ isDefault: 'desc' }, { displayName: 'asc' }],
      }),
      getWorkflowTargets(prisma, organisation.id),
    ]);
    return jsonResponse(200, {
      organisation: { id: organisation.id, name: organisation.name },
      role: membership.role,
      defaults,
      certifierPresets,
      workflowTargets,
    });
  }, context);
