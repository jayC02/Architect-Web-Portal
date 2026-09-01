export const prerender = false;

import { AutomationJobType } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisation, requireOrganisationRole } from '@/server/permissions/authz';
import {
  agentEnrollmentExpiry,
  agentEnrollmentTokenHash,
  createAgentEnrollmentToken,
} from '@/server/auth/agent-credential';
import { agentSupportsJob, healthyAgentCutoff } from '@/server/services/desktop-agent.service';

export const GET: APIRoute = (context) => withErrorHandling(async () => {
  const { organisation, membership, user } = await requireOrganisation(context);
  const canManageAll = membership.role === 'OWNER' || membership.role === 'ADMIN';
  const agents = await prisma.agentRegistration.findMany({
    where: {
      organisationId: organisation.id,
      ...(canManageAll ? {} : { enrolledByUserId: user.id }),
    },
    select: {
      id: true, machineName: true, agentVersion: true, capabilities: true, enabled: true,
      revokedAt: true, lastSeenAt: true, operatingState: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  const healthyAfter = healthyAgentCutoff();
  return jsonResponse(200, {
    agents: agents.map((agent) => {
      const connected = Boolean(agent.enabled && !agent.revokedAt && agent.lastSeenAt && agent.lastSeenAt > healthyAfter);
      const usable = connected && [AutomationJobType.HOUSEHOLDER_PLANNING, AutomationJobType.BUILDING_WARRANT]
        .some((type) => agentSupportsJob(agent, { type, payloadVersion: 2 }));
      return { ...agent, connected, usable };
    }),
    canManageAll,
  });
}, context);

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  assertRateLimit(context, rateLimitPolicies.auth, 'desktop-agent:enrollment');
  const { organisation, user } = await requireOrganisationRole(context, ['OWNER', 'ADMIN']);
  const token = createAgentEnrollmentToken();
  const expiresAt = agentEnrollmentExpiry();
  await prisma.agentEnrollmentToken.create({
    data: {
      organisationId: organisation.id,
      createdByUserId: user.id,
      tokenHash: agentEnrollmentTokenHash(token),
      expiresAt,
    },
  });
  return jsonResponse(201, { token, organisationId: organisation.id, expiresAt: expiresAt.toISOString() });
}, context);
