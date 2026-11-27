import type { OrganisationRole, Prisma, PrismaClient } from '@prisma/client';
import { createOpaqueToken, hashOpaqueToken } from '@/lib/auth/tokens';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';

// Team invitations and the plan's user limit. A workspace's users are its
// members plus anyone with a pending invitation, so a limit can't be beaten by
// sending invitations faster than they're accepted.

type Db = PrismaClient | Prisma.TransactionClient;

export const TEAM_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const USER_LIMIT_CODE = 'USER_LIMIT_REACHED';
export const INVITABLE_ROLES: OrganisationRole[] = ['MEMBER', 'ADMIN'];

/** Pure: is there room for one more user? A null limit is unlimited. */
export const seatsAvailable = (input: { limit: number | null; members: number; pending: number }) =>
  input.limit === null || input.members + input.pending < input.limit;

export const userLimitMessage = (limit: number) =>
  `Your plan includes up to ${limit} user${limit === 1 ? '' : 's'}. Remove someone or change plan to add more.`;

const pendingWhere = (organisationId: string, now: Date): Prisma.TeamInviteWhereInput => ({
  organisationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now },
});

export const seatUsage = async (db: Db, organisationId: string, now: Date = new Date()) => {
  const [subscription, members, pending] = await Promise.all([
    db.organisationSubscription.findUnique({ where: { organisationId }, select: { userLimit: true } }),
    db.organisationMember.count({ where: { organisationId } }),
    db.teamInvite.count({ where: pendingWhere(organisationId, now) }),
  ]);
  return { limit: subscription?.userLimit ?? null, members, pending };
};

// Serialise changes to one workspace's team so two invitations (or two
// acceptances) can't both take the last place.
const lockTeam = (tx: Prisma.TransactionClient, organisationId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`team:${organisationId}`}))`;

export const createTeamInvite = async (input: {
  organisationId: string;
  email: string;
  role: OrganisationRole;
  invitedById: string;
  now?: Date;
}) => {
  if (!INVITABLE_ROLES.includes(input.role)) throw new HttpError(400, 'Invite people as a member or an admin.');
  const now = input.now ?? new Date();
  const email = input.email.trim().toLowerCase();
  const token = `tmi_${createOpaqueToken(32)}`;

  const invite = await prisma.$transaction(async (tx) => {
    await lockTeam(tx, input.organisationId);
    const existingUser = await tx.user.findUnique({
      where: { email },
      select: { organisationLinks: { select: { organisationId: true } } },
    });
    if (existingUser?.organisationLinks.some((link) => link.organisationId === input.organisationId)) {
      throw new HttpError(409, `${email} is already in your team.`);
    }
    if (existingUser?.organisationLinks.length) {
      throw new HttpError(409, `${email} already uses Architect Pro with another workspace. Invite a different email address.`);
    }
    // A new invitation to the same email replaces the old one rather than taking another place.
    await tx.teamInvite.updateMany({
      where: { ...pendingWhere(input.organisationId, now), email },
      data: { revokedAt: now },
    });
    const usage = await seatUsage(tx, input.organisationId, now);
    if (!seatsAvailable(usage)) throw new HttpError(409, userLimitMessage(usage.limit!), { code: USER_LIMIT_CODE });
    return tx.teamInvite.create({
      data: {
        organisationId: input.organisationId,
        email,
        role: input.role,
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(now.getTime() + TEAM_INVITE_TTL_MS),
        invitedById: input.invitedById,
      },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
  });
  return { invite, token };
};

const usableInvite = (now: Date): Prisma.TeamInviteWhereInput => ({ acceptedAt: null, revokedAt: null, expiresAt: { gt: now } });

/** The invitation behind a link, for showing the sign-up page. */
export const findTeamInviteByToken = (token: string, now: Date = new Date()) =>
  prisma.teamInvite.findFirst({
    where: { tokenHash: hashOpaqueToken(token), ...usableInvite(now) },
    select: { id: true, email: true, role: true, organisationId: true, organisation: { select: { name: true } } },
  });

/** Google sign-up: Google has verified the email, so a pending invitation for it is enough. */
export const findTeamInviteForVerifiedEmail = (email: string, now: Date = new Date()) =>
  prisma.teamInvite.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, ...usableInvite(now) },
    orderBy: { createdAt: 'desc' },
    select: { id: true, email: true, role: true, organisationId: true, organisation: { select: { name: true } } },
  });

export const INVITE_UNUSABLE_MESSAGE = 'This invitation has expired, been cancelled or already been used. Ask your practice to send a new one.';

/**
 * Inside the sign-up transaction: claim the invitation and check the user limit
 * again (it may have been lowered since the invitation was sent). Returns the
 * membership to create for the new user.
 */
export const acceptTeamInvite = async (
  tx: Prisma.TransactionClient,
  input: { inviteId: string; organisationId: string; email: string; now?: Date },
) => {
  const now = input.now ?? new Date();
  await lockTeam(tx, input.organisationId);
  const invite = await tx.teamInvite.findFirst({
    where: { id: input.inviteId, organisationId: input.organisationId, ...usableInvite(now) },
    select: { id: true, email: true, role: true },
  });
  if (!invite) throw new HttpError(410, INVITE_UNUSABLE_MESSAGE);
  if (invite.email.toLowerCase() !== input.email.toLowerCase()) {
    throw new HttpError(403, `This invitation was sent to ${invite.email}. Sign up with that email address.`);
  }
  const [limit, members] = await Promise.all([
    tx.organisationSubscription.findUnique({ where: { organisationId: input.organisationId }, select: { userLimit: true } }),
    tx.organisationMember.count({ where: { organisationId: input.organisationId } }),
  ]);
  // This invitation's own place is already counted, so only members matter here.
  if (!seatsAvailable({ limit: limit?.userLimit ?? null, members, pending: 0 })) {
    throw new HttpError(409, 'This practice has reached its plan user limit. Ask them to free a place or change plan.', { code: USER_LIMIT_CODE });
  }
  const claimed = await tx.teamInvite.updateMany({ where: { id: invite.id, ...usableInvite(now) }, data: { acceptedAt: now } });
  if (!claimed.count) throw new HttpError(410, INVITE_UNUSABLE_MESSAGE);
  return { role: invite.role, organisationId: input.organisationId };
};

export const listTeam = async (organisationId: string, now: Date = new Date()) => {
  const [members, invites, usage] = await Promise.all([
    prisma.organisationMember.findMany({
      where: { organisationId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.teamInvite.findMany({
      where: pendingWhere(organisationId, now),
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    }),
    seatUsage(prisma, organisationId, now),
  ]);
  return { members, invites, usage };
};

export const revokeTeamInvite = async (organisationId: string, inviteId: string, now: Date = new Date()) => {
  const revoked = await prisma.teamInvite.updateMany({
    where: { id: inviteId, ...pendingWhere(organisationId, now) },
    data: { revokedAt: now },
  });
  if (!revoked.count) throw new HttpError(404, 'That invitation is no longer pending.');
};

export const removeTeamMember = async (input: { organisationId: string; memberId: string; actorUserId: string }) => {
  const member = await prisma.organisationMember.findFirst({
    where: { id: input.memberId, organisationId: input.organisationId },
    select: { id: true, role: true, userId: true },
  });
  if (!member) throw new HttpError(404, 'That person is not in your team.');
  if (member.role === 'OWNER') throw new HttpError(409, 'The workspace owner cannot be removed.');
  if (member.userId === input.actorUserId) throw new HttpError(409, 'You cannot remove yourself. Ask the owner to do it.');
  await prisma.$transaction(async (tx) => {
    await tx.organisationMember.delete({ where: { id: member.id } });
    // Signed-in sessions stop working for this workspace straight away.
    await tx.session.deleteMany({ where: { userId: member.userId } });
  });
};
