import crypto from 'node:crypto';
import type { APIContext } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { withPerf } from '@/lib/utils/perf';

const SESSION_COOKIE = 'architect_portal_session';
const SESSION_TTL_DAYS = 90;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const SESSION_RENEWAL_WINDOW_MS = SESSION_TTL_MS - 24 * 60 * 60 * 1000;

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

const setSessionCookie = (context: APIContext, token: string, expiresAt: Date) => {
  context.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: import.meta.env?.PROD || process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
  });
};

const refreshSession = async (
  session: { id: string; expiresAt: Date; lastSeenAt: Date },
  rawToken: string,
  context: APIContext,
) => {
  const now = Date.now();
  const shouldRenew = session.expiresAt.getTime() - now <= SESSION_RENEWAL_WINDOW_MS;

  if (shouldRenew) {
    const refreshedExpiresAt = new Date(now + SESSION_TTL_MS);
    await withPerf('auth.renew_session', () =>
      prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now), expiresAt: refreshedExpiresAt },
      }),
    );
    setSessionCookie(context, rawToken, refreshedExpiresAt);
    return;
  }

  if (session.lastSeenAt.getTime() < now - 10 * 60 * 1000) {
    await withPerf('auth.touch_session', () =>
      prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now) },
      }),
    );
  }
};

export const createSession = async (userId: string, context: APIContext) => {
  const token = crypto.randomBytes(48).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      ipAddress: context.clientAddress,
      userAgent: context.request.headers.get('user-agent') ?? undefined,
    },
  });

  setSessionCookie(context, token, expiresAt);
};

export const destroySession = async (context: APIContext) => {
  const rawToken = context.cookies.get(SESSION_COOKIE)?.value;
  if (rawToken) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(rawToken) } });
  }
  context.cookies.delete(SESSION_COOKIE, { path: '/' });
};

export const getSessionUser = async (context: APIContext) => {
  const rawToken = context.cookies.get(SESSION_COOKIE)?.value;
  if (!rawToken) return null;

  const session = await withPerf('auth.session_user', () => prisma.session.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true,
      expiresAt: true,
      lastSeenAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  }));

  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } });
    context.cookies.delete(SESSION_COOKIE, { path: '/' });
    return null;
  }

  await refreshSession(session, rawToken, context);

  return session.user;
};

export const getSessionAuth = async (context: APIContext) => {
  const rawToken = context.cookies.get(SESSION_COOKIE)?.value;
  if (!rawToken) return null;

  const session = await withPerf('auth.session_auth', () => prisma.session.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true,
      expiresAt: true,
      lastSeenAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          updatedAt: true,
          organisationLinks: {
            include: { organisation: true },
            orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
            take: 1,
          },
        },
      },
    },
  }));

  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } });
    context.cookies.delete(SESSION_COOKIE, { path: '/' });
    return null;
  }

  await refreshSession(session, rawToken, context);

  const [membership] = session.user.organisationLinks;
  if (!membership) return null;
  const { organisationLinks, ...user } = session.user;
  return { user, membership, organisation: membership.organisation };
};

export const sessionCookieName = SESSION_COOKIE;
