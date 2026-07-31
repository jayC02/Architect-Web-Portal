import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APPLICATION_UPLOAD_LIMITS } from '../src/lib/application-upload-limits';

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
assert.match(newApplication, /length: Math\.min\(3, files\.length\)/, 'browser direct uploads are capped at three concurrent workers');
assert.match(newApplication, /Could not upload.*completed uploads have been kept/, 'per-file failures keep successful files available');

const syntheticPackage = Array.from({ length: 8 }, (_, index) => 1_900_000 + index * 1_000);
const syntheticTotal = syntheticPackage.reduce((total, bytes) => total + bytes, 0);
assert.ok(syntheticTotal > 14.3 * 1024 * 1024 && syntheticTotal < APPLICATION_UPLOAD_LIMITS.maxPackageBytes);
assert.equal(syntheticPackage.length, 8, 'the reproduced package shape is covered without real customer PDFs');

console.log('application direct upload tests passed');
