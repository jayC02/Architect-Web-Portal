export const prerender = false;

import type { APIRoute } from 'astro';
import { absoluteUrl } from '@/lib/config';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { accessRequestReviewSchema } from '@/lib/validation/access';
import { requirePlatformAdmin } from '@/server/billing/admin';
import { createInviteToken } from '@/server/billing/onboarding';
import { sendAccessInviteEmail } from '@/server/services/email.service';

export const POST: APIRoute = (context) => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  const auth = await requirePlatformAdmin(context);
  const { action } = await parseBody(context.request, accessRequestReviewSchema);
  const request = await prisma.accessRequest.findUnique({ where: { id: context.params.id ?? '' } });
  if (!request) throw new HttpError(404, 'Access request not found.');
  if (request.acceptedAt) throw new HttpError(409, 'This invitation has already been used to create a workspace.');

  if (action === 'reject') {
    await prisma.accessRequest.update({
      where: { id: request.id },
      data: { status: 'REJECTED', inviteTokenHash: null, inviteExpiresAt: null, reviewedAt: new Date(), reviewedByEmail: auth.user.email },
    });
    return jsonResponse(200, { ok: true });
  }

  if (action === 'resend' && request.status !== 'APPROVED') throw new HttpError(409, 'Approve this request first.');
  // Approving (or resending) issues a fresh single-use link and invalidates any older one.
  const invite = createInviteToken();
  await prisma.accessRequest.update({
    where: { id: request.id },
    data: {
      status: 'APPROVED', inviteTokenHash: invite.tokenHash, inviteExpiresAt: invite.expiresAt,
      reviewedAt: new Date(), reviewedByEmail: auth.user.email,
    },
  });
  const inviteUrl = absoluteUrl(`/register?invite=${encodeURIComponent(invite.token)}`);
  let emailed = false;
  try {
    emailed = await sendAccessInviteEmail(request.email, request.name, inviteUrl);
  } catch (error) {
    console.error('Invite email failed', error);
  }
  return jsonResponse(200, { ok: true, inviteUrl, emailed });
}, context);
