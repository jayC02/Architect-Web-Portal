const FALLBACK_PATH = '/dashboard';

export const safeReturnTo = (value: string | null | undefined, fallback = FALLBACK_PATH) => {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const resolved = new URL(value, 'https://architectpro.invalid');
    if (resolved.origin !== 'https://architectpro.invalid') return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
};

export const returnToQuery = (value: string | null | undefined) => {
  const safe = safeReturnTo(value);
  return safe === FALLBACK_PATH ? '' : `?returnTo=${encodeURIComponent(safe)}`;
};
