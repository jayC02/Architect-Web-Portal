import type { APIContext } from 'astro';
import { getSessionAuth } from '@/lib/auth/session';
import { privateNoStore, setAstroCache } from '@/lib/server/cache-control';

type PageContext = APIContext & { response: { headers: Headers } };

export const requirePageAuth = async (Astro: PageContext) => {
  setAstroCache(Astro, privateNoStore);
  return getSessionAuth(Astro);
};
