export const prerender = false;

import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { createSession } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { registerSchema } from '@/lib/validation/auth';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { slugify } from '@/lib/utils/slug';
import {
  findInviteByToken,
  markInviteAccepted,
  postSignupRedirect,
  signupMode,
  subscriptionCreateFor,
} from '@/server/billing/onboarding';
import { acceptTeamInvite, findTeamInviteByToken, INVITE_UNUSABLE_MESSAGE } from '@/server/billing/team';

const resolveOrganisationSlug = async (name: string) => {
  const base = slugify(name);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await prisma.organisation.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
  }
  return `${base}-${Date.now()}`;
};

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.auth, 'register');
    const body = await parseBody(context.request, registerSchema);

    const existing = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
    if (existing) throw new HttpError(409, 'A user with that email already exists.');

    // Joining a practice's team: no new workspace, and the practice's plan applies.
    if (body.team) {
      const teamInvite = await findTeamInviteByToken(body.team);
      if (!teamInvite) throw new HttpError(410, INVITE_UNUSABLE_MESSAGE);
      const passwordHash = await hashPassword(body.password);
      const user = await prisma.$transaction(async (tx) => {
        const membership = await acceptTeamInvite(tx, {
          inviteId: teamInvite.id, organisationId: teamInvite.organisationId, email: body.email,
        });
        return tx.user.create({
          data: {
            name: body.name,
            email: body.email,
            passwordHash,
            organisationLinks: { create: { role: membership.role, organisationId: membership.organisationId } },
          },
          select: { id: true, name: true, email: true },
        });
      });
      await createSession(user.id, context);
      return jsonResponse(201, { user, redirectTo: '/dashboard' });
    }

    // No free accounts: either an approved demo invite (14-day trial) or the
    // workspace starts unpaid and is sent to checkout.
    const invite = body.invite ? await findInviteByToken(body.invite, body.email) : null;
    if (!invite && signupMode() === 'invite_only') {
      throw new HttpError(403, 'Architect Pro is invitation only at the moment. Request a demo and we will send you an invitation.');
    }

    const passwordHash = await hashPassword(body.password);
    const organisationName = body.organisationName!;
    const organisationSlug = await resolveOrganisationSlug(organisationName);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: body.name,
          email: body.email,
          passwordHash,
          organisationLinks: {
            create: {
              role: 'OWNER',
              organisation: {
                create: {
                  name: organisationName,
                  slug: organisationSlug,
                  calendarConnections: {
                    create: [{ provider: 'GOOGLE' }, { provider: 'OUTLOOK' }],
                  },
                  subscription: { create: subscriptionCreateFor(invite) },
                },
              },
            },
          },
        },
        select: { id: true, name: true, email: true, organisationLinks: { select: { organisationId: true }, take: 1 } },
      });
      if (invite) await markInviteAccepted(tx, invite.id, created.organisationLinks[0].organisationId);
      const { organisationLinks, ...rest } = created;
      return rest;
    });

    await createSession(user.id, context);
    return jsonResponse(201, { user, redirectTo: postSignupRedirect(Boolean(invite), body.plan, body.billing) });
  }, context);