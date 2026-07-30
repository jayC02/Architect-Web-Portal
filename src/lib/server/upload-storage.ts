import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from '@/lib/utils/http';

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
};

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const SUPABASE_CONFIG_ERROR =
  'Supabase storage is not configured. Check UPLOAD_STORAGE_PROVIDER, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET.';

type SaveUploadedDocumentOptions = {
  folder: string;
  maxBytes?: number;
  label?: string;
};

type SavedDocument = {
  fileName: string;
  storageUrl: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
};

const getStorageProvider = () => process.env.UPLOAD_STORAGE_PROVIDER ?? 'local';
const getLocalDir = () => process.env.UPLOAD_STORAGE_DIR ?? '.runtime/uploads';
const LEGACY_LOCAL_DIR = 'public/uploads';

const getRequiredSupabaseConfig = () => {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET;

  if (!supabaseUrl || !supabaseServiceRoleKey || !supabaseBucket) {
    throw new HttpError(500, SUPABASE_CONFIG_ERROR);
  }

  return { supabaseUrl, supabaseServiceRoleKey, supabaseBucket };
};

const normalizeFolder = (folder: string) => {
  const normalized = folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) throw new HttpError(500, 'Upload folder is required.');
  if (path.isAbsolute(folder) || path.win32.isAbsolute(folder) || path.posix.isAbsolute(normalized)) {
    throw new HttpError(500, 'Upload folder must be relative.');
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new HttpError(500, 'Upload folder cannot contain parent directory segments.');
  }

  return segments.filter(Boolean).join('/');
};

export const normalizeStorageKey = (storageKey: string) => {
  const normalized = storageKey.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.split('/').some((segment) => segment === '..') || path.isAbsolute(storageKey) || path.win32.isAbsolute(storageKey)) {
    throw new HttpError(400, 'Document storage key is invalid.');
  }
  return normalized;
};

export const resolveStoredDocumentKey = (storageKey?: string | null, legacyStorageUrl?: string | null) => {
  if (storageKey) return normalizeStorageKey(storageKey);
  if (!legacyStorageUrl) throw new HttpError(404, 'Document file is not available.');

  const value = legacyStorageUrl.trim();
  const publicMarker = '/storage/v1/object/public/';
  const markerIndex = value.indexOf(publicMarker);
  if (markerIndex >= 0) {
    const remainder = value.slice(markerIndex + publicMarker.length);
    const slashIndex = remainder.indexOf('/');
    if (slashIndex < 0) throw new HttpError(404, 'Legacy document reference is invalid.');
    return normalizeStorageKey(decodeURIComponent(remainder.slice(slashIndex + 1)));
  }

  if (value.startsWith('/uploads/')) {
    return normalizeStorageKey(decodeURIComponent(value.slice('/uploads/'.length)));
  }
  throw new HttpError(404, 'Legacy document reference cannot be resolved safely.');
};

const assertSafeOriginalName = (file: File, label: string) => {
  if (!file.name) return;
  if (file.name.includes('/') || file.name.includes('\\') || file.name.split('.').includes('..')) {
    throw new HttpError(400, `${label} filename is invalid.`);
  }
};

export async function saveUploadedDocument(file: File, options: SaveUploadedDocumentOptions): Promise<SavedDocument> {
  const label = options.label?.trim() || 'document';
  const folder = normalizeFolder(options.folder);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  if (!file.size) throw new HttpError(400, `Please choose a ${label} file before saving.`);
  assertSafeOriginalName(file, label);
  if (!MIME_TO_EXT[file.type]) throw new HttpError(400, `${label} file type is not supported.`);
  if (file.size > maxBytes) throw new HttpError(400, `${label} is too large.`);

  const provider = getStorageProvider();
  if (process.env.NODE_ENV === 'production' && provider !== 'supabase') {
    throw new HttpError(500, 'Production document uploads require Supabase Storage. Set UPLOAD_STORAGE_PROVIDER=supabase.');
  }

  const ext = MIME_TO_EXT[file.type];
  const fileName = `${Date.now()}-${randomUUID()}${ext}`;
  const storageKey = path.posix.join(folder, fileName);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (file.type === 'application/pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new HttpError(400, `${label} is not a valid PDF file.`);
  }

  if (provider === 'supabase') {
    const { supabaseUrl, supabaseServiceRoleKey, supabaseBucket } = getRequiredSupabaseConfig();
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${supabaseBucket}/${storageKey}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${supabaseServiceRoleKey}`,
        apikey: supabaseServiceRoleKey,
        'content-type': file.type,
        'x-upsert': 'false',
      },
      body: bytes,
    });

    if (!response.ok) throw new HttpError(500, `Failed to upload file. ${await response.text()}`.trim());
    return {
      fileName,
      storageUrl: '',
      storageKey,
      mimeType: file.type,
      sizeBytes: file.size,
    };
  }

  if (provider !== 'local') {
    throw new HttpError(500, `Unsupported upload storage provider: ${provider}.`);
  }

  const configuredLocalDir = getLocalDir();
  const storageRoot = path.isAbsolute(configuredLocalDir) ? configuredLocalDir : path.resolve(process.cwd(), configuredLocalDir);
  const diskPath = path.join(storageRoot, ...folder.split('/'));
  await fs.mkdir(diskPath, { recursive: true });
  await fs.writeFile(path.join(diskPath, fileName), bytes);

  return {
    fileName,
    storageUrl: '',
    storageKey,
    mimeType: file.type,
    sizeBytes: file.size,
  };
}

export async function readStoredDocumentBytes(storageKey?: string | null, legacyStorageUrl?: string | null): Promise<Buffer> {
  const safeKey = resolveStoredDocumentKey(storageKey, legacyStorageUrl);
  const provider = getStorageProvider();

  if (provider === 'supabase') {
    const { supabaseUrl, supabaseServiceRoleKey, supabaseBucket } = getRequiredSupabaseConfig();
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${supabaseBucket}/${safeKey}`, {
      headers: {
        authorization: `Bearer ${supabaseServiceRoleKey}`,
        apikey: supabaseServiceRoleKey,
      },
    });
    if (!response.ok) throw new HttpError(404, 'Document file could not be opened.');
    return Buffer.from(await response.arrayBuffer());
  }

  if (provider !== 'local') throw new HttpError(500, `Unsupported upload storage provider: ${provider}.`);

  const configuredLocalDir = getLocalDir();
  const storageRoot = path.isAbsolute(configuredLocalDir) ? configuredLocalDir : path.resolve(process.cwd(), configuredLocalDir);
  const resolvedRoot = path.resolve(storageRoot);
  const resolvedFile = path.resolve(resolvedRoot, safeKey);
  if (!resolvedFile.toLowerCase().startsWith(resolvedRoot.toLowerCase() + path.sep)) {
    throw new HttpError(400, 'Document path is invalid.');
  }
  let bytes = await fs.readFile(resolvedFile).catch(() => null);
  if (!bytes && !process.env.UPLOAD_STORAGE_DIR) {
    const legacyRoot = path.resolve(process.cwd(), LEGACY_LOCAL_DIR);
    const legacyFile = path.resolve(legacyRoot, safeKey);
    if (legacyFile.toLowerCase().startsWith(legacyRoot.toLowerCase() + path.sep)) {
      bytes = await fs.readFile(legacyFile).catch(() => null);
    }
  }
  if (!bytes) throw new HttpError(404, 'Document file could not be opened.');
  return bytes;
}

export async function deleteStoredDocument(storageKey: string): Promise<void> {
  const safeKey = normalizeStorageKey(storageKey);
  const provider = getStorageProvider();

  if (provider === 'supabase') {
    const { supabaseUrl, supabaseServiceRoleKey, supabaseBucket } = getRequiredSupabaseConfig();
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${supabaseBucket}/${safeKey}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${supabaseServiceRoleKey}`,
        apikey: supabaseServiceRoleKey,
      },
    });
    if (!response.ok && response.status !== 404) {
      throw new HttpError(500, 'Draft document could not be removed.');
    }
    return;
  }

  if (provider !== 'local') throw new HttpError(500, `Unsupported upload storage provider: ${provider}.`);

  const configuredLocalDir = getLocalDir();
  const storageRoot = path.isAbsolute(configuredLocalDir) ? configuredLocalDir : path.resolve(process.cwd(), configuredLocalDir);
  const resolvedRoot = path.resolve(storageRoot);
  const resolvedFile = path.resolve(resolvedRoot, safeKey);
  if (!resolvedFile.toLowerCase().startsWith(resolvedRoot.toLowerCase() + path.sep)) {
    throw new HttpError(400, 'Document path is invalid.');
  }
  await fs.unlink(resolvedFile).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
