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
const getLocalDir = () => process.env.UPLOAD_STORAGE_DIR ?? 'public/uploads';

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
      storageUrl: `${supabaseUrl}/storage/v1/object/public/${supabaseBucket}/${storageKey}`,
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
    storageUrl: `/${path.posix.join('uploads', storageKey)}`,
    storageKey,
    mimeType: file.type,
    sizeBytes: file.size,
  };
}
