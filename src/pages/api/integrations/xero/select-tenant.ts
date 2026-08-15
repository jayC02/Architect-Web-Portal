export const prerender = false;

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { absoluteUrl } from '@/lib/config';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseForm } from '@/lib/utils/handlers';
import { completePendingTenantSelection } from '@/lib/xero/oauth';
import { syncXeroOrganisation } from '@/lib/xero/sync';
import { requireOrganisationRole } from '@/server/permissions/authz';

const schema = z.object({ tenantId: z.string().uuid() });

export const POST: APIRoute = async (context) => {
  try {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.oauth, 'xero:select-tenant');
    const { organisation, user } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
    const { tenantId } = await parseForm(context.request, schema);
    await completePendingTenantSelection(context, organisation.id, user.id, tenantId);
    await syncXeroOrganisation(organisation.id).catch(() => undefined);
    return context.redirect(`${absoluteUrl('/settings/integrations')}?xero=connected`, 303);
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : 'Xero organisation selection failed.');
    return context.redirect(`${absoluteUrl('/settings/integrations')}?xero=error&message=${message}`, 303);
  }
};
