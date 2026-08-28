export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { agentSetupAuthorisationSchema } from '@/lib/validation/desktop-agent';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import {
  AGENT_SETUP_COOKIE,
  agentEnrollmentTokenHash,
  agentSetupIntentTokenHash,
  clearAgentSetupCookie,
  createAgentEnrollmentToken,
  createAgentSetupIntentToken,
  pkceAgentEnrollmentExpiry,
} from '@/server/auth/agent-credential';
import { requireOrganisation } from '@/server/permissions/authz';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.auth, 'desktop-agent:authorise');
  const { organisation, user } = await requireOrganisation(context);
  const body = await parseBody(context.request, agentSetupAuthorisationSchema);
  const setupToken = context.cookies.get(AGENT_SETUP_COOKIE)?.value;
  const now = new Date();
  const grant = createAgentEnrollmentToken();
  const expiresAt = pkceAgentEnrollmentExpiry();

  await prisma.$transaction(async (tx) => {
    let setupIntentConsumed = false;
    if (setupToken) {
      const consumed = await tx.agentSetupIntent.updateMany({
        where: {
          tokenHash: agentSetupIntentTokenHash(setupToken),
          organisationId: organisation.id,
          createdByUserId: user.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      setupIntentConsumed = consumed.count === 1;
      if (!consumed.count && !body.confirmed) {
        throw new HttpError(409, 'SETUP_CONFIRMATION_REQUIRED');
      }
    } else if (!body.confirmed) {
      throw new HttpError(409, 'SETUP_CONFIRMATION_REQUIRED');
    }

    if (!setupIntentConsumed) {
      const recoveryToken = createAgentSetupIntentToken();
      await tx.agentSetupIntent.create({
        data: {
          organisationId: organisation.id,
          createdByUserId: user.id,
          tokenHash: agentSetupIntentTokenHash(recoveryToken),
          expiresAt: now,
          usedAt: now,
        },
      });
    }

    await tx.agentEnrollmentToken.create({
      data: {
        organisationId: organisation.id,
        createdByUserId: user.id,
        tokenHash: agentEnrollmentTokenHash(grant),
        installationId: body.installationId,
        codeChallenge: body.codeChallenge,
        expiresAt,
      },
    });
  });

  clearAgentSetupCookie(context);
  const callback = new URL(`http://127.0.0.1:${body.port}/callback`);
  callback.searchParams.set('grant', grant);
  callback.searchParams.set('state', body.state);
  return jsonResponse(201, { callbackUrl: callback.toString(), expiresAt: expiresAt.toISOString() });
}, context);
