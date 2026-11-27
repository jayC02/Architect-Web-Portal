// Route classification for the access middleware. Kept separate from the
// middleware so it can be unit tested without Astro.

// Marketing, legal and sign-in pages anyone can see.
const PUBLIC_EXACT = new Set([
  '/', '/login', '/register', '/forgot-password', '/reset-password',
  '/privacy', '/terms', '/features', '/pricing', '/demo', '/about', '/contact', '/faq', '/security',
  // Handles its own sign-in redirect (to /register, carrying the plan).
  '/subscribe',
  '/robots.txt', '/sitemap.xml', '/favicon.ico', '/favicon.svg',
  // Billing webhook is authenticated by its Stripe signature.
  '/api/billing/webhook',
  // Public demo-request form.
  '/api/access-requests',
  // Public release metadata only (no download), used by Agent update checks.
  '/api/desktop/releases/latest',
]);

const PUBLIC_PREFIXES = [
  '/_astro/', '/_image', '/_server-islands/', '/brand/', '/fonts/', '/product/',
  '/auth/', '/api/auth/',
  // Cron routes authenticate with CRON_SECRET.
  '/api/cron/',
];

// Routes that authenticate themselves with an Agent or desktop bearer token and
// check the organisation's subscription there (see requireAgentAuth).
const SELF_AUTHENTICATED_PREFIXES = ['/api/desktop/', '/agent/download'];

// Signed-in, but must stay reachable while the subscription is inactive so the
// customer can pay, sign out or (for platform admins) manage access.
const SESSION_ONLY_EXACT = new Set(['/billing']);
const SESSION_ONLY_PREFIXES = ['/api/billing/', '/admin', '/api/admin/'];

export type PathAccess = 'public' | 'self' | 'session' | 'entitled';

const normalise = (pathname: string) => (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname);

export const classifyPath = (rawPathname: string): PathAccess => {
  const pathname = normalise(rawPathname);
  if (PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return 'public';
  if (SELF_AUTHENTICATED_PREFIXES.some((prefix) => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix))) return 'self';
  if (SESSION_ONLY_EXACT.has(pathname) || SESSION_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))) return 'session';
  return 'entitled';
};

export const isApiPath = (pathname: string) => pathname.startsWith('/api/');
