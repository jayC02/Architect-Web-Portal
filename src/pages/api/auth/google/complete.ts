export const prerender = false;

import type { APIRoute } from 'astro';
import {
  clearPendingGoogleSignupCookie,
  GOOGLE_SIGNUP_COOKIE,
  pendingGoogleSignupReturnTo,
} from '@/lib/auth/oauth';
import { resolveOrganisationSlug } from '@/lib/auth/organisation';
import { createSession } from '@/lib/auth/session';
import { hashOpaqueToken } from '@/lib/auth/tokens';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { completeGoogleSignupSchema } from '@/lib/validation/auth';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import {
  findInviteForVerifiedEmail,
  markInviteAccepted,
  postSignupRedirect,
  signupMode,
  subscriptionCreateFor,
} from '@/server/billing/onboarding';
import { acceptTeamInvite, findTeamInviteForVerifiedEmail } from '@/server/billing/team';

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.oauth, 'google-complete');
    const body = await parseBody(context.request, completeGoogleSignupSchema);
    const rawToken = context.cookies.get(GOOGLE_SIGNUP_COOKIE)?.value;
    if (!rawToken) throw new HttpError(400, 'This Google sign-up has expired. Please try again.');

    const pending = await prisma.pendingOAuthSignup.findUnique({
      where: { tokenHash: hashOpaqueToken(rawToken) },
    });
    if (!pending || pending.expiresAt.getTime() < Date.now()) {
      clearPendingGoogleSignupCookie(context);
      throw new HttpError(400, 'This Google sign-up has expired. Please try again.');
    }

    // A pending team invitation for this verified email means joining that practice.
    const teamInvite = await findTeamInviteForVerifiedEmail(pending.email);
    if (!teamInvite && !body.organisationName) throw new HttpError(400, 'Enter your organisation name.');
    const organisationSlug = teamInvite ? null : await resolveOrganisationSlug(body.organisationName!);
    const invite = teamInvite ? null : await findInviteForVerifiedEmail(pending.email);
    let createdWorkspace = false;
    const userId = await prisma.$transaction(async (tx) => {
      const linkedProvider = await tx.authProvider.findUnique({
        where: {
          provider_providerAccountId: {
            provider: pending.provider,
            providerAccountId: pending.providerAccountId,
          },
        },
        select: { userId: true },
      });

      if (linkedProvider) {
        await tx.pendingOAuthSignup.delete({ where: { id: pending.id } });
        return linkedProvider.userId;
      }

      const existingUser = await tx.user.findUnique({
        where: { email: pending.email },
        select: { id: true, passwordHash: true },
      });
      if (existingUser) {
        if (existingUser.passwordHash) {
          clearPendingGoogleSignupCookie(context);
          throw new HttpError(409, 'This email already has a password account. Sign in with your password, then connect Google from Settings > Preferences.');
        }
        await tx.authProvider.create({
          data: {
            userId: existingUser.id,
            provider: pending.provider,
            providerAccountId: pending.providerAccountId,
            email: pending.email,
            displayName: pending.displayName,
            avatarUrl: pending.avatarUrl,
          },
        });
        await tx.pendingOAuthSignup.delete({ where: { id: pending.id } });
        return existingUser.id;
      }

      if (teamInvite) {
        const membership = await acceptTeamInvite(tx, {
          inviteId: teamInvite.id, organisationId: teamInvite.organisationId, email: pending.email,
        });
        const joined = await tx.user.create({
          data: {
            name: pending.displayName,
            email: pending.email,
            passwordHash: null,
            authProviders: {
              create: {
                provider: pending.provider,
                providerAccountId: pending.providerAccountId,
                email: pending.email,
                displayName: pending.displayName,
                avatarUrl: pending.avatarUrl,
              },
            },
            organisationLinks: { create: { role: membership.role, organisationId: membership.organisationId } },
          },
          select: { id: true },
        });
        await tx.pendingOAuthSignup.delete({ where: { id: pending.id } });
        return joined.id;
      }

      if (!invite && signupMode() === 'invite_only') {
        throw new HttpError(403, 'Architect Pro is invitation only at the moment. Request a demo and we will send you an invitation.');
      }
      const user = await tx.user.create({
        data: {
          name: pending.displayName,
          email: pending.email,
          passwordHash: null,
          authProviders: {
            create: {
              provider: pending.provider,
              providerAccountId: pending.providerAccountId,
              email: pending.email,
              displayName: pending.displayName,
              avatarUrl: pending.avatarUrl,
            },
          },
          organisationLinks: {
            create: {
              role: 'OWNER',
              organisation: {
                create: {
                  name: body.organisationName!,
                  slug: organisationSlug!,
                  calendarConnections: {
                    create: [{ provider: 'GOOGLE' }, { provider: 'OUTLOOK' }],
                  },
                  subscription: { create: subscriptionCreateFor(invite) },
                },
              },
            },
          },
        },
        select: { id: true, organisationLinks: { select: { organisationId: true }, take: 1 } },
      });
      if (invite) await markInviteAccepted(tx, invite.id, user.organisationLinks[0].organisationId);
      await tx.pendingOAuthSignup.delete({ where: { id: pending.id } });
      createdWorkspace = true;
      return user.id;
    });

    const returnTo = createdWorkspace && !invite
      ? postSignupRedirect(false)
      : pendingGoogleSignupReturnTo(context);
    clearPendingGoogleSignupCookie(context);
    await createSession(userId, context);
    return jsonResponse(201, { redirectTo: returnTo });
  }, context);
