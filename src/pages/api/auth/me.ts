export const prerender = false;

import type { APIRoute } from 'astro';
import { requireOrganisation } from '@/server/permissions/authz';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { user, organisation, membership } = await requireOrganisation(context);
    return jsonResponse(200, {
      user,
      organisation: { id: organisation.id, name: organisation.name, slug: organisation.slug },
      role: membership.role,
    });
  });
