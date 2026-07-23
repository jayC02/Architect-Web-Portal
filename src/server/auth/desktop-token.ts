import crypto from 'node:crypto';
import type { APIContext } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';

const TOKEN_PREFIX = 'apd_';
const TOKEN_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
const HANDOFF_PREFIX = 'aph_';
const HANDOFF_LIFETIME_MS = 5 * 60 * 1000;
const JOB_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

const hashToken = (token: string) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

export const createDesktopTokenValue = () => `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
export const desktopTokenExpiry = () => new Date(Date.now() + TOKEN_LIFETIME_MS);
export const desktopTokenHash = hashToken;
export const desktopTokenPrefix = (token: string) => token.slice(0, 12);
export const createDesktopHandoffCode = () => `${HANDOFF_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
export const desktopHandoffCodeHash = hashToken;
export const desktopHandoffExpiry = () => new Date(Date.now() + HANDOFF_LIFETIME_MS);
export const desktopJobTokenExpiry = () => new Date(Date.now() + JOB_TOKEN_LIFETIME_MS);
export const buildDesktopLaunchUrl = (jobId: string, handoffCode: string, portalOrigin: string) => {
  const params = new URLSearchParams({ code: handoffCode, portal: portalOrigin });
  return `architectpro://automation/${jobId}?${params.toString()}`;
};

export const requireDesktopAuth = async (context: APIContext) => {
  const authorization = context.request.headers.get('authorization') ?? '';
  const [scheme, token] = authorization.split(' ', 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token?.startsWith(TOKEN_PREFIX)) {
    throw new HttpError(401, 'Desktop authentication required.');
  }

  const access = await prisma.desktopAccessToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      organisation: { select: { id: true, name: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (!access || access.revokedAt || access.expiresAt <= new Date()) {
    throw new HttpError(401, 'Desktop access has expired or been revoked.');
  }

  if (!access.lastUsedAt || Date.now() - access.lastUsedAt.getTime() > 5 * 60 * 1000) {
    void prisma.desktopAccessToken.update({ where: { id: access.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return access;
};

export const assertDesktopJobAccess = (access: { automationJobId?: string | null }, jobId: string) => {
  if (access.automationJobId && access.automationJobId !== jobId) {
    throw new HttpError(404, 'Automation job not found or unavailable.');
  }
};
