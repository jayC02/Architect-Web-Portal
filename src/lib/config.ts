const DEFAULT_SITE_URL = 'http://localhost:4321';

const normalizeOrigin = (value: string) => value.replace(/\/$/, '');

export const siteConfig = {
  name: 'Architect Pro',
  domain: 'architect-portal.local',
  defaultDescription: 'A secure practice hub for architectural projects, documents, statutory applications, and deadlines.',
  siteUrl: normalizeOrigin(import.meta.env?.PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || DEFAULT_SITE_URL),
};

export const absoluteUrl = (path = '/') => {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return new URL(cleanPath, `${siteConfig.siteUrl}/`).toString();
};

export const safeExternalUrl = (value: string | null | undefined) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
};
