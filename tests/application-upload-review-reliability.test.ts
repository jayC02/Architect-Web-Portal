import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  UploadRequestError,
  isRetryableUploadError,
  retryTransientUpload,
} from '../src/lib/application-upload-queue';

const completedDocuments: string[] = [];
let successfulCycleRequests = 0;
let successfulCycleRetries = 0;
const uploadedDocument = await retryTransientUpload(async () => {
  successfulCycleRequests += 1;
  if (successfulCycleRequests === 1) throw new UploadRequestError('Temporary storage failure.', 503);
  completedDocuments.push('document-1');
  return 'document-1';
}, {
  delayMs: 0,
  onRetry: () => { successfulCycleRetries += 1; },
});

assert.equal(uploadedDocument, 'document-1');
assert.equal(successfulCycleRequests, 2, 'one transient failure receives one automatic retry');
assert.equal(successfulCycleRetries, 1);
assert.deepEqual(completedDocuments, ['document-1'], 'a recovered cycle produces one completed document');

let failedCycleRequests = 0;
await assert.rejects(
  retryTransientUpload(async () => {
    failedCycleRequests += 1;
    throw new UploadRequestError('Storage remains unavailable.', 500);
  }, { delayMs: 0 }),
  /Storage remains unavailable/,
);
assert.equal(failedCycleRequests, 2, 'a failed cycle stops after the automatic retry');

for (const status of [400, 401, 403, 404, 507]) {
  let requests = 0;
  await assert.rejects(
    retryTransientUpload(async () => {
      requests += 1;
      throw new UploadRequestError('Permanent upload failure.', status);
    }, { delayMs: 0 }),
  );
  assert.equal(requests, 1, `HTTP ${status} is not retried`);
}

for (const status of [408, 429, 500, 502, 503, 504]) {
  assert.equal(isRetryableUploadError(new UploadRequestError('Temporary failure.', status)), true);
}
assert.equal(isRetryableUploadError(new TypeError('Failed to fetch')), true, 'network failures are retryable');

const uploadPage = fs.readFileSync('src/pages/applications/new.astro', 'utf8');
const reviewComponent = fs.readFileSync('src/components/applications/ApplicationDraftReview.tsx', 'utf8');

assert.match(uploadPage, /state: 'Retrying upload\.\.\.'/);
assert.match(uploadPage, /uploadsInFlight\.has\(key\)/, 'the same file cannot start concurrent retry cycles');
assert.match(uploadPage, /retryTransientUpload\(async \(\) =>/);
assert.match(uploadPage, /Unable to upload document:/, 'two failed attempts retain the manual error state');
assert.match(uploadPage, /response\.status === 409[\s\S]*already exists/i, 'a lost success response reuses the existing storage object');

assert.match(reviewComponent, /const \[editingDocumentId, setEditingDocumentId\]/);
assert.match(reviewComponent, /aria-label={`Change category for \$\{source\?\.originalFilename/);
assert.match(reviewComponent, /<Pencil size=\{13\}/);
assert.match(reviewComponent, /autoFocus/, 'focus moves into the reopened category selector');
assert.match(reviewComponent, /event\.key === 'Escape'/);
assert.match(reviewComponent, />\s*Cancel\s*<\/button>/);
assert.match(reviewComponent, /const previousReview = reviewRef\.current/);
assert.match(reviewComponent, /const saved = await persistCurrentReview\(\)/, 'initial review and later corrections use the existing save path');
assert.match(reviewComponent, /reviewRef\.current = previousReview/, 'failed category saves restore the last saved review');
assert.equal(
  (reviewComponent.match(/void changeDocumentType\(document\.id, event\.target\.value\)/g) ?? []).length,
  2,
  'both the initial and reopened category selectors share one update handler',
);
assert.match(reviewComponent, /editingDocumentId === document\.id/, 'only the selected document row opens');

console.log('application upload retry and category edit regression tests passed');
