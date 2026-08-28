export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import {
  agentSetupIntentExpiry,
  agentSetupIntentTokenHash,
  createAgentSetupIntentToken,
  setAgentSetupCookie,
} from '@/server/auth/agent-credential';
import { requireOrganisation } from '@/server/permissions/authz';
import { agentReleaseMetadata } from '@/server/services/agent-release.service';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.auth, 'desktop-agent:setup');
  const { organisation, user } = await requireOrganisation(context);
  const release = agentReleaseMetadata();
  if (release.status !== 'AVAILABLE') {
    throw new HttpError(503, 'The latest Architect Pro Agent installer is being prepared. Try again shortly.');
  }

  const token = createAgentSetupIntentToken();
  const expiresAt = agentSetupIntentExpiry();
  await prisma.agentSetupIntent.create({
    data: {
      organisationId: organisation.id,
      createdByUserId: user.id,
      tokenHash: agentSetupIntentTokenHash(token),
      expiresAt,
    },
  });
  setAgentSetupCookie(context, token);
  return jsonResponse(201, { release, expiresAt: expiresAt.toISOString() });
}, context);
