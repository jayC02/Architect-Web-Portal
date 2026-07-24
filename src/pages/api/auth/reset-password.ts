export const prerender = false;

import type { APIRoute } from 'astro';
import { hashPassword } from '@/lib/auth/password';
import { hashOpaqueToken } from '@/lib/auth/tokens';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { resetPasswordSchema } from '@/lib/validation/auth';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';

export const POST: APIRoute = (context) =>
  withErrorHandling(async () => {
    assertAllowedOrigin(context.request);
    assertRateLimit(context, rateLimitPolicies.passwordReset, 'reset-password');
    const body = await parseBody(context.request, resetPasswordSchema);
    const tokenHash = hashOpaqueToken(body.token);
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt.getTime() < Date.now()) {
      throw new HttpError(400, 'This password reset link is invalid or has expired.');
    }

    const passwordHash = await hashPassword(body.password);
    const claimed = await prisma.$transaction(async (tx) => {
      const result = await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (result.count !== 1) return false;

      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: resetToken.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.session.deleteMany({ where: { userId: resetToken.userId } });
      return true;
    });

    if (!claimed) throw new HttpError(400, 'This password reset link is invalid or has expired.');
    return jsonResponse(200, { redirectTo: '/login?reset=success' });
  }, context);
