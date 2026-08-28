export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { agentEnrollmentExchangeSchema } from '@/lib/validation/desktop-agent';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import {
  agentCredentialHash,
  agentCredentialPrefix,
  agentEnrollmentTokenHash,
  createAgentCredential,
  verifyPkceChallenge,
} from '@/server/auth/agent-credential';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.auth, 'desktop-agent:exchange');
  const body = await parseBody(context.request, agentEnrollmentExchangeSchema);
  const now = new Date();
  const credential = createAgentCredential();
  const result = await prisma.$transaction(async (tx) => {
    const rawGrant = 'grant' in body ? body.grant : body.token;
    const enrollment = await tx.agentEnrollmentToken.findUnique({ where: { tokenHash: agentEnrollmentTokenHash(rawGrant) } });
    if (!enrollment || ('organisationId' in body && enrollment.organisationId !== body.organisationId)) {
      throw new HttpError(403, 'This enrollment token does not belong to the selected organisation.');
    }
    if ('grant' in body) {
      if (!enrollment.installationId || enrollment.installationId !== body.installationId) {
        throw new HttpError(403, 'This enrollment grant belongs to another Agent installation.');
      }
      if (!enrollment.codeChallenge || !verifyPkceChallenge(body.codeVerifier, enrollment.codeChallenge)) {
        throw new HttpError(403, 'This enrollment grant could not be verified.');
      }
    }
    const consumed = await tx.agentEnrollmentToken.updateMany({
      where: { id: enrollment.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (!consumed.count) throw new HttpError(410, 'This enrollment token has expired or already been used.');
    const existing = await tx.agentRegistration.findUnique({ where: { installationId: body.installationId } });
    if (existing && existing.organisationId !== enrollment.organisationId && existing.enabled && !existing.revokedAt) {
      throw new HttpError(403, 'This Agent installation is already enrolled with another organisation.');
    }
    const data = {
      organisationId: enrollment.organisationId,
      enrolledByUserId: enrollment.createdByUserId,
      machineName: body.machineName,
      agentVersion: body.agentVersion,
      capabilities: body.capabilities,
      credentialHash: agentCredentialHash(credential),
      credentialPrefix: agentCredentialPrefix(credential),
      enabled: true,
      revokedAt: null,
    };
    return existing
      ? tx.agentRegistration.update({ where: { id: existing.id }, data })
      : tx.agentRegistration.create({ data: { installationId: body.installationId, ...data } });
  });
  return jsonResponse(201, { credential, agentId: result.id, organisationId: result.organisationId });
}, context);
