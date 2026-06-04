import { HttpError } from '@/lib/utils/http';

const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:4321'];

const normalizeOrigin = (value: string | null | undefined) => {
  if (!value) return null;

  try {
    return new URL(value.trim().replace(/\/+$/, '')).origin;
  } catch {
    return null;
  }
};

const getConfiguredAllowedOrigins = () => {
  const values = [
    process.env.PUBLIC_SITE_URL,
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(process.env.PUBLIC_ALLOWED_ORIGINS?.split(',') ?? []),
  ];

  return values.map(normalizeOrigin).filter((origin): origin is string => Boolean(origin));
};

export const assertAllowedOrigin = (request: Request) => {
  if (!MUTATION_METHODS.has(request.method.toUpperCase())) return;

  const requestOrigin = normalizeOrigin(request.url);
  const submittedOrigin = normalizeOrigin(request.headers.get('origin')) ?? normalizeOrigin(request.headers.get('referer'));
  const allowedOrigins = new Set([requestOrigin, ...getConfiguredAllowedOrigins()].filter((origin): origin is string => Boolean(origin)));

  if (!submittedOrigin || !allowedOrigins.has(submittedOrigin)) {
    console.warn('blocked mutation request: invalid origin', { submittedOrigin, requestOrigin });
    throw new HttpError(403, 'Invalid request origin.');
  }
};
