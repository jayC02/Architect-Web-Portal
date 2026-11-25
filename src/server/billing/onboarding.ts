import type { AccessRequest, Prisma } from '@prisma/client';
import { createOpaqueToken, hashOpaqueToken } from '@/lib/auth/tokens';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';
import { isBillingInterval, isPlanId, TRIAL_AGENT_DEVICE_LIMIT, TRIAL_DAYS } from '@/config/plans';

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type SignupMode = 'invite_only' | 'paid_or_invite';
export const signupMode = (): SignupMode =>
  process.env.SIGNUP_MODE?.trim().toLowerCase() === 'invite_only' ? 'invite_only' : 'paid_or_invite';

export const createInviteToken = () => {
  const token = `api_${createOpaqueToken(32)}`;
  return { token, tokenHash: hashOpaqueToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) };
};

const usableInviteWhere = (now: Date): Prisma.AccessRequestWhereInput => ({
  status: 'APPROVED', acceptedAt: null, inviteExpiresAt: { gt: now },
});

// Password sign-up: the invite link is the proof, and it is bound to the email
// the demo was requested with.
export const findInviteByToken = async (token: string, email: string) => {
  const invite = await prisma.accessRequest.findFirst({
    where: { inviteTokenHash: hashOpaqueToken(token), ...usableInviteWhere(new Date()) },
  });
  if (!invite) throw new HttpError(410, 'This invitation has expired or has already been used. Ask us for a new one.');
  if (invite.email.toLowerCase() !== email.toLowerCase()) {
    throw new HttpError(403, `This invitation was issued to ${invite.email}. Register with that email address.`);
  }
  return invite;
};

// Google sign-up: Google has verified the email, so an approved request for it
// is enough without the link.
export const findInviteForVerifiedEmail = (email: string) =>
  prisma.accessRequest.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, ...usableInviteWhere(new Date()) },
    orderBy: { reviewedAt: 'desc' },
  });

export const subscriptionCreateFor = (invite: Pick<AccessRequest, 'plan'> | null): Prisma.OrganisationSubscriptionCreateWithoutOrganisationInput => {
  if (!invite) return { status: 'PENDING_PAYMENT', source: 'SELF_SERVE', agentDeviceLimit: 1 };
  const plan = isPlanId(invite.plan) ? invite.plan : 'practice';
  return {
    status: 'TRIALING',
    source: 'DEMO_INVITE',
    plan,
    trialEndsAt: new Date(Date.now() + TRIAL_DAYS * DAY_MS),
    // Evaluation workspaces get one licensed Agent computer whatever the plan.
    agentDeviceLimit: TRIAL_AGENT_DEVICE_LIMIT,
  };
};

export const markInviteAccepted = async (tx: Prisma.TransactionClient, inviteId: string, organisationId: string) => {
  const claimed = await tx.accessRequest.updateMany({
    where: { id: inviteId, ...usableInviteWhere(new Date()) },
    data: { acceptedAt: new Date(), organisationId },
  });
  if (!claimed.count) throw new HttpError(410, 'This invitation has expired or has already been used. Ask us for a new one.');
};

export const postSignupRedirect = (hasTrial: boolean, plan?: string | null, billing?: string | null) => {
  if (hasTrial) return '/dashboard';
  if (isPlanId(plan)) {
    const interval = isBillingInterval(billing) ? billing : 'monthly';
    return `/subscribe?plan=${plan}&billing=${interval}`;
  }
  return '/billing';
};
