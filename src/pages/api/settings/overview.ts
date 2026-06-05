export const prerender = false;

import type { APIRoute } from 'astro';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation, membership } = await requireOrganisation(context);
    return jsonResponse(200, {
      organisation: { id: organisation.id, name: organisation.name },
      role: membership.role,
    });
  });
