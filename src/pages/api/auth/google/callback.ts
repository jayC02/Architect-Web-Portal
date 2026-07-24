export const prerender = false;

import type { APIRoute } from 'astro';
import {
  consumeGoogleOAuthCookies,
  oauthSignupExpiresAt,
  setPendingGoogleSignupCookie,
} from '@/lib/auth/oauth';
import { createSession } from '@/lib/auth/session';
import { createOpaqueToken, hashOpaqueToken } from '@/lib/auth/tokens';
import { prisma } from '@/lib/db/prisma';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { exchangeGoogleCode } from '@/server/services/google-auth.service';

const loginError = (context: Parameters<APIRoute>[0]) =>
  context.redirect('/login?authError=google_failed');

export const GET: APIRoute = async (context) => {
  try {
    assertRateLimit(context, rateLimitPolicies.oauth, 'google-callback');
    if (context.url.searchParams.get('error')) return loginError(context);

    const code = context.url.searchParams.get('code');
    const state = context.url.searchParams.get('state');
    if (!code || !state) return loginError(context);

    const codeVerifier = consumeGoogleOAuthCookies(context, state);
    const profile = await exchangeGoogleCode(code, codeVerifier);

    const linkedProvider = await prisma.authProvider.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'GOOGLE',
          providerAccountId: profile.accountId,
        },
      },
      select: { userId: true },
    });

    if (linkedProvider) {
      await createSession(linkedProvider.userId, context);
      return context.redirect('/dashboard');
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: profile.email },
      select: { id: true },
    });

    if (existingUser) {
      await prisma.authProvider.upsert({
        where: {
          provider_providerAccountId: {
            provider: 'GOOGLE',
            providerAccountId: profile.accountId,
          },
        },
        update: {
          email: profile.email,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
        },
        create: {
          userId: existingUser.id,
          provider: 'GOOGLE',
          providerAccountId: profile.accountId,
          email: profile.email,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
        },
      });
      await createSession(existingUser.id, context);
      return context.redirect('/dashboard');
    }

    const signupToken = createOpaqueToken();
    await prisma.pendingOAuthSignup.upsert({
      where: {
        provider_providerAccountId: {
          provider: 'GOOGLE',
          providerAccountId: profile.accountId,
        },
      },
      update: {
        tokenHash: hashOpaqueToken(signupToken),
        email: profile.email,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        expiresAt: oauthSignupExpiresAt(),
      },
      create: {
        tokenHash: hashOpaqueToken(signupToken),
        provider: 'GOOGLE',
        providerAccountId: profile.accountId,
        email: profile.email,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        expiresAt: oauthSignupExpiresAt(),
      },
    });
    setPendingGoogleSignupCookie(context, signupToken);
    return context.redirect('/auth/google/complete');
  } catch (error) {
    console.error('Google authentication callback failed.', error instanceof Error ? error.message : '');
    return loginError(context);
  }
};
