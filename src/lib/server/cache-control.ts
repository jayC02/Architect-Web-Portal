export const publicStatic = 'public, max-age=31536000, immutable';
export const publicPageShort = 'public, max-age=0, must-revalidate';
export const publicPageMedium = 'public, max-age=0, must-revalidate';
export const publicApiShort = 'public, max-age=0, s-maxage=30, stale-while-revalidate=60';
export const privateNoStore = 'private, no-store, max-age=0, must-revalidate';
export const privateApiNoStore = 'private, no-store, max-age=0, must-revalidate';

export const setAstroCache = (Astro: { response: { headers: Headers } }, value: string) => {
  Astro.response.headers.set('Cache-Control', value);
};

export const cacheHeaders = {
  PUBLIC_STATIC: publicStatic,
  PUBLIC_SHORT: publicPageShort,
  PUBLIC_MEDIUM: publicPageMedium,
  PRIVATE_NO_STORE: privateNoStore,
  API_PRIVATE_NO_STORE: privateApiNoStore,
  API_PUBLIC_SHORT: publicApiShort,
} as const;
