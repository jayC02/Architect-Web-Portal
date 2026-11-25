export const prerender = false;

import type { APIRoute } from 'astro';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireAgentAuth } from '@/server/auth/agent-credential';
import { assertOrganisationEntitled } from '@/server/billing/access';
import { buildLicenceClaims, licenceKeyId, signLicence } from '@/server/billing/licence';

// Issues a short-lived signed licence to an enrolled Agent of an entitled
// organisation. The Agent calls this on start-up and whenever `refreshAfter`
// passes; 401 = this computer was disconnected, 402 = subscription inactive.
export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-agent:licence');
  const agent = await requireAgentAuth(context);
  const { subscription, entitlement } = await assertOrganisationEntitled(agent.organisationId);
  const claims = buildLicenceClaims({ agent, subscription, entitlement });
  return jsonResponse(200, {
    licence: signLicence(claims),
    keyId: licenceKeyId(),
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    refreshAfter: new Date(claims.rfa * 1000).toISOString(),
    status: entitlement.status,
    warning: entitlement.warning,
  });
}, context);
