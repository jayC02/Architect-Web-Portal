export const privateNoStore = 'private, no-store, max-age=0, must-revalidate';
export const privateApiNoStore = 'private, no-store, max-age=0, must-revalidate';

export const setAstroCache = (Astro: { response: { headers: Headers } }, value: string) => {
  Astro.response.headers.set('Cache-Control', value);
};
