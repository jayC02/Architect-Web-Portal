import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveStoredDocumentKey, saveUploadedDocument } from '../src/lib/server/upload-storage';

const previous = {
  provider: process.env.UPLOAD_STORAGE_PROVIDER,
  directory: process.env.UPLOAD_STORAGE_DIR,
  nodeEnv: process.env.NODE_ENV,
};
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'architectpro-upload-test-'));

try {
  process.env.UPLOAD_STORAGE_PROVIDER = 'local';
  process.env.UPLOAD_STORAGE_DIR = directory;
  process.env.NODE_ENV = 'test';

  const valid = new File([Buffer.from('%PDF-1.7\nvalid test document')], 'drawing.pdf', {
    type: 'application/pdf',
  });
  const saved = await saveUploadedDocument(valid, { folder: 'organisations/org/projects/project' });
  assert.equal(saved.storageUrl, '', 'new private documents do not persist a public URL');
  assert.ok(saved.storageKey.endsWith('.pdf'));
  assert.equal((await fs.readFile(path.join(directory, saved.storageKey))).subarray(0, 5).toString(), '%PDF-');

  const fake = new File([Buffer.from('not a pdf')], 'renamed.pdf', { type: 'application/pdf' });
  await assert.rejects(
    saveUploadedDocument(fake, { folder: 'organisations/org/projects/project' }),
    /not a valid PDF/i,
  );

  await assert.rejects(
    saveUploadedDocument(valid, { folder: 'organisations/org/projects/project', maxBytes: 4 }),
    /too large/i,
  );

  assert.equal(
    resolveStoredDocumentKey(
      null,
      'https://example.supabase.co/storage/v1/object/public/private-documents/organisations/org/projects/project/file.pdf',
    ),
    'organisations/org/projects/project/file.pdf',
  );
  assert.equal(
    resolveStoredDocumentKey(null, '/uploads/organisations/org/projects/project/file.pdf'),
    'organisations/org/projects/project/file.pdf',
  );
} finally {
  if (previous.provider === undefined) delete process.env.UPLOAD_STORAGE_PROVIDER;
  else process.env.UPLOAD_STORAGE_PROVIDER = previous.provider;
  if (previous.directory === undefined) delete process.env.UPLOAD_STORAGE_DIR;
  else process.env.UPLOAD_STORAGE_DIR = previous.directory;
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
  await fs.rm(directory, { recursive: true, force: true });
}

console.log('upload storage tests passed');
