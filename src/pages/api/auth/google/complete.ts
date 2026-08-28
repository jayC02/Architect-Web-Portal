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

    const organisationSlug = await resolveOrganisationSlug(body.organisationName);
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
        select: { id: true },
      });
      if (existingUser) {
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
                  name: body.organisationName,
                  slug: organisationSlug,
                  calendarConnections: {
                    create: [{ provider: 'GOOGLE' }, { provider: 'OUTLOOK' }],
                  },
                },
              },
            },
          },
        },
        select: { id: true },
      });
      await tx.pendingOAuthSignup.delete({ where: { id: pending.id } });
      return user.id;
    });

    const returnTo = pendingGoogleSignupReturnTo(context);
    clearPendingGoogleSignupCookie(context);
    await createSession(userId, context);
    return jsonResponse(201, { redirectTo: returnTo });
  }, context);
