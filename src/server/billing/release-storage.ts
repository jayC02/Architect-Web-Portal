import path from 'node:path';
import { HttpError } from '@/lib/utils/http';

// Installers live in a private Supabase Storage bucket. Entitled users and
// Agents get a signed URL that expires after a few minutes, so a link pasted
// into a forum or email stops working almost immediately.

export const RELEASE_URL_TTL_SECONDS = 5 * 60;

const releaseStorageConfig = () => {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.AGENT_RELEASE_BUCKET?.trim() || 'agent-releases';
  return url && key ? { url, key, bucket } : null;
};

// Local development without Supabase: set AGENT_RELEASE_LOCAL_DIR to the
// absolute path of the repo's agent-releases/ folder. It is only read from env
// (no literal path) so Vercel's file tracer never bundles 1.2 GB of installers
// into the server function.
const localReleasePath = (storageKey: string) => {
  const dir = process.env.AGENT_RELEASE_LOCAL_DIR?.trim();
  return dir ? path.join(dir, storageKey) : null;
};

export type ReleaseLocation = { kind: 'redirect'; url: string } | { kind: 'local'; path: string };

export const resolveReleaseLocation = async (storageKey: string, filename: string): Promise<ReleaseLocation> => {
  if (!/^[A-Za-z0-9._-]+$/.test(storageKey)) throw new HttpError(500, 'Invalid release storage key.');
  const config = releaseStorageConfig();
  if (!config) {
    const local = process.env.NODE_ENV !== 'production' ? localReleasePath(storageKey) : null;
    if (local) return { kind: 'local', path: local };
    throw new HttpError(503, 'The Agent download is being prepared. Please try again shortly.');
  }
  return { kind: 'redirect', url: await createSignedReleaseUrl(config, storageKey, filename) };
};

const createSignedReleaseUrl = async (
  config: NonNullable<ReturnType<typeof releaseStorageConfig>>, storageKey: string, filename: string,
) => {
  const response = await fetch(`${config.url}/storage/v1/object/sign/${encodeURIComponent(config.bucket)}/${encodeURIComponent(storageKey)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.key}`, apikey: config.key, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: RELEASE_URL_TTL_SECONDS }),
  });
  const payload = await response.json().catch(() => ({})) as { signedURL?: string };
  if (!response.ok || !payload.signedURL) {
    console.error('Agent release signing failed', response.status, storageKey);
    throw new HttpError(503, 'The Agent download is being prepared. Please try again shortly.');
  }
  const signed = new URL(`${config.url}/storage/v1${payload.signedURL}`);
  signed.searchParams.set('download', filename);
  return signed.toString();
};
