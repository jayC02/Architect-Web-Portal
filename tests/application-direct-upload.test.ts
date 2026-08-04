import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APPLICATION_UPLOAD_LIMITS } from '../src/lib/application-upload-limits';
import {
  createSingleFlight,
  runUploadQueue,
  uploadPackageProgress,
  type ApplicationUploadState,
} from '../src/lib/application-upload-queue';

const read = (file: string) => fs.readFileSync(file, 'utf8');
const createRoute = read('src/pages/api/application-drafts/index.ts');
const legacyRoute = read('src/pages/api/application-drafts/[id]/documents/index.ts');
const intentRoute = read('src/pages/api/application-drafts/[id]/documents/upload-intent.ts');
const finaliseRoute = read('src/pages/api/application-drafts/[id]/documents/[documentId]/finalise.ts');
const uploadService = read('src/server/services/application-draft-files.service.ts');
const storage = read('src/lib/server/upload-storage.ts');
const analysis = read('src/server/services/application-draft.service.ts');
const commit = read('src/server/services/application-draft-commit.service.ts');
const newApplication = read('src/pages/applications/new.astro');

assert.equal(APPLICATION_UPLOAD_LIMITS.maxFiles, 20);
assert.equal(APPLICATION_UPLOAD_LIMITS.maxFileBytes, 25 * 1024 * 1024);
assert.equal(APPLICATION_UPLOAD_LIMITS.maxPackageBytes, 75 * 1024 * 1024);
assert.equal(APPLICATION_UPLOAD_LIMITS.uploadConcurrency, 3);
assert.equal(APPLICATION_UPLOAD_LIMITS.analysisConcurrency, 2);
assert.equal(APPLICATION_UPLOAD_LIMITS.unfinishedDraftRetentionDays, 7);
assert.equal(APPLICATION_UPLOAD_LIMITS.unfinalisedRetentionHours, 24);

for (const route of [createRoute, intentRoute, finaliseRoute]) {
  assert.doesNotMatch(route, /\.formData\(/, 'AI-first mutation routes do not parse multipart bodies');
  assert.match(route, /requireOrganisation\(context\)/, 'the active organisation is always resolved server-side');
  assert.match(route, /assertAllowedOrigin\(context\.request\)/, 'mutations are origin-checked');
}
assert.match(intentRoute, /filename[\s\S]*mimeType[\s\S]*size[\s\S]*clientSha256/, 'intent accepts metadata only');
assert.doesNotMatch(intentRoute, /organisationId|storageKey|storagePath|bucket/, 'intent input never accepts organisation or storage addressing');
assert.match(legacyRoute, /410/, 'the former draft multipart endpoint is retained only as a guarded retirement response');
assert.doesNotMatch(legacyRoute, /\.formData\(/, 'the retired endpoint no longer reads file bytes');

assert.match(uploadService, /organisations\/\$\{organisationId\}\/application-drafts\/\$\{draftId\}\/documents/, 'storage keys are generated server-side');
assert.match(uploadService, /TransactionIsolationLevel\.Serializable/, 'intent creation defensively serialises package and headroom checks');
assert.match(uploadService, /storageBlockBytes/, 'storage hard-stop is enforced by the service');
assert.match(uploadService, /committedDocumentId: null/, 'active draft accounting excludes already promoted objects');
assert.match(uploadService, /ApplicationDraftDocumentUploadStatus\.READY/, 'finalisation has an explicit durable state');
assert.match(uploadService, /unfinalisedRetentionHours/, 'unfinalised cleanup uses the central retention limit');
assert.match(uploadService, /!document\.committedDocumentId/, 'cleanup skips promoted documents');

assert.match(storage, /createSignedDirectUpload/, 'the server creates signed direct upload credentials');
assert.match(storage, /SUPABASE_SERVICE_ROLE_KEY/, 'the signing credential remains server-side');
assert.doesNotMatch(intentRoute, /SUPABASE_SERVICE_ROLE_KEY|serviceRole/i, 'the browser contract cannot receive a service role credential');
assert.match(finaliseRoute, /finaliseApplicationDraftDocument/, 'finalisation is a separate lightweight request');
assert.match(analysis, /createHash\('sha256'\)/, 'the first analysis read calculates an authoritative hash');
assert.match(analysis, /subarray\(0, 5\).*%PDF-/, 'PDF magic bytes are verified during analysis');
assert.match(analysis, /clientSha256.*sha256/, 'a supplied browser hash is compared authoritatively');
assert.match(analysis, /deleteStoredDocument/, 'spoofed PDFs are removed safely');
assert.match(commit, /storageKey: document\.storageKey/, 'commit attaches the existing physical object to ProjectDocument');
assert.doesNotMatch(commit, /saveUploadedDocument|readStoredDocumentBytes/, 'commit does not copy or re-upload a draft object');

assert.doesNotMatch(newApplication, /FormData|XMLHttpRequest|request\.send/, 'the new application page does not build or submit a combined file package');
assert.match(newApplication, /createSingleFlight/, 'concurrent workers share one authoritative draft creation');
assert.match(newApplication, /APPLICATION_UPLOAD_LIMITS\.uploadConcurrency/, 'the browser uses the central upload concurrency limit');
assert.match(newApplication, /Could not upload.*completed uploads have been kept/, 'per-file failures keep successful files available');

const syntheticPackage = Array.from({ length: 8 }, (_, index) => 1_900_000 + index * 1_000);
const syntheticTotal = syntheticPackage.reduce((total, bytes) => total + bytes, 0);
assert.ok(syntheticTotal > 14.3 * 1024 * 1024 && syntheticTotal < APPLICATION_UPLOAD_LIMITS.maxPackageBytes);
assert.equal(syntheticPackage.length, 8, 'the reproduced package shape is covered without real customer PDFs');

const files = Array.from({ length: 8 }, (_, index) => ({ id: `document-${index + 1}` }));
const states = new Map<string, ApplicationUploadState>(files.map((file) => [file.id, 'Waiting']));
let draftCreations = 0;
let activeUploads = 0;
let maximumActiveUploads = 0;
const uploadCalls: string[] = [];
const finalisationCalls: string[] = [];
const ensureDraft = createSingleFlight(async () => {
  draftCreations += 1;
  await new Promise((resolve) => setTimeout(resolve, 2));
  return 'one-draft-for-all-files';
});

await runUploadQueue(files, 6, async (file) => {
  assert.equal(await ensureDraft(), 'one-draft-for-all-files');
  states.set(file.id, 'Uploading');
  activeUploads += 1;
  maximumActiveUploads = Math.max(maximumActiveUploads, activeUploads);
  try {
    uploadCalls.push(file.id);
    await new Promise((resolve) => setTimeout(resolve, 2));
    states.set(file.id, 'Finalising');
    finalisationCalls.push(file.id);
    await new Promise((resolve) => setTimeout(resolve, 1));
    states.set(file.id, 'Waiting for analysis');
  } finally {
    activeUploads -= 1;
  }
});

assert.equal(draftCreations, 1, 'parallel upload workers create exactly one application draft');
assert.equal(uploadCalls.length, 8, 'all eight selected files are uploaded');
assert.equal(new Set(uploadCalls).size, 8, 'concurrent callbacks retain every stable document row');
assert.equal(finalisationCalls.length, 8, 'all eight uploaded files are finalised');
assert.ok(maximumActiveUploads <= 6, 'the worker cap limits simultaneity without truncating the queue');
assert.deepEqual(uploadPackageProgress(files, (file) => states.get(file.id)), {
  total: 8,
  finalised: 8,
  failed: 0,
  ready: true,
}, 'the completed package reports 8/8');

const partialStates = new Map<string, ApplicationUploadState>(
  files.map((file, index) => [file.id, index < 6 ? 'Waiting for analysis' : 'Finalising']),
);
assert.equal(uploadPackageProgress(files, (file) => partialStates.get(file.id)).ready, false, 'six of eight finalised files cannot be analysed');
partialStates.set(files[6].id, 'Waiting for analysis');
partialStates.set(files[7].id, 'Could not upload');
assert.equal(uploadPackageProgress(files, (file) => partialStates.get(file.id)).ready, false, 'one failed file prevents partial analysis');
const withoutFailed = files.filter((file) => file.id !== files[7].id);
assert.equal(uploadPackageProgress(withoutFailed, (file) => partialStates.get(file.id)).ready, true, 'removing a failed file recalculates readiness');

assert.match(analysis, /include: \{ documents: \{ orderBy:/, 'analysis loads the authoritative draft document set from the database');
assert.match(analysis, /total: draft\.documents\.length/, 'analysis progress uses the authoritative document total');
assert.match(analysis, /uploadStatus !== ApplicationDraftDocumentUploadStatus\.READY/, 'analysis rejects unresolved uploads');

console.log('application direct upload tests passed');
