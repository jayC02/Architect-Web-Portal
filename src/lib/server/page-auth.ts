import type { APIContext } from 'astro';
import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { privateNoStore, setAstroCache } from '@/lib/server/cache-control';

type PageContext = APIContext & { response: { headers: Headers } };

export const requirePageAuth = async (Astro: PageContext) => {
  setAstroCache(Astro, privateNoStore);
  const user = await getSessionUser(Astro);
  if (!user) return null;

  const membership = await prisma.organisationMember.findFirst({
    where: { userId: user.id },
    include: { organisation: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });

  if (!membership) return null;
  return { user, membership, organisation: membership.organisation };
};
