import type { APIContext } from 'astro';
import { getSessionAuth } from '@/lib/auth/session';
import { HttpError } from '@/lib/utils/http';
import { isPlatformAdmin } from '@/server/billing/access';

// Platform (Architect Pro staff) admins, configured by PLATFORM_ADMIN_EMAILS.
// Not the same as an organisation's OWNER/ADMIN role.
export const requirePlatformAdmin = async (context: APIContext) => {
  const auth = await getSessionAuth(context);
  if (!auth) throw new HttpError(401, 'Authentication required.');
  if (!isPlatformAdmin(auth.user.email)) throw new HttpError(404, 'Not found.');
  return auth;
};
