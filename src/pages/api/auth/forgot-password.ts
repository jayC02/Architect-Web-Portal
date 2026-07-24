export const prerender = false;

import type { APIRoute } from 'astro';
import { createOpaqueToken, hashOpaqueToken } from '@/lib/auth/tokens';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { forgotPasswordSchema } from '@/lib/validation/auth';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { sendPasswordResetEmail } from '@/server/services/email.service';

const GENERIC_MESSAGE =
  'If an account exists for that email, a password reset link has been sent.';

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.passwordReset, 'forgot-password');
    const body = await parseBody(context.request, forgotPasswordSchema);
    const user = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true, email: true },
    });

    if (user) {
      const rawToken = createOpaqueToken();
      const token = await prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        return tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashOpaqueToken(rawToken),
            expiresAt: new Date(Date.now() + 45 * 60 * 1000),
          },
          select: { id: true },
        });
      });

      try {
        await sendPasswordResetEmail(user.email, rawToken);
      } catch {
        await prisma.passwordResetToken.updateMany({
          where: { id: token.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        console.error('Password reset email could not be delivered.');
      }
    }

    return jsonResponse(200, { message: GENERIC_MESSAGE });
  }, context);
