import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { desktopJobStatusSchema } from '../src/lib/validation/desktop-handoff';
import { readAutomationFailureMetadata } from '../src/lib/automation/failure-recovery';
import AutomationFailureRecovery from '../src/components/automation/AutomationFailureRecovery';

const documentFailure = {
  filename: 'ground-floor.pdf', operation: 'Saving supporting document',
  reasonCode: 'DUPLICATE_DOCUMENT', reason: 'The portal rejected the document: A document with this title already exists.',
  portalMessage: 'A document with this title already exists.', uploadedCount: 2,
};
const result = {
  outcome: 'failed_final', currentSection: 'documents', errorCode: 'DOCUMENT_UPLOAD_FAILED',
  failureCategory: 'DOCUMENT_UPLOAD_FAILED', errorSummary: documentFailure.reason,
  documentFailure, nextAction: 'Open the existing ePlanning draft. Compare this file with the attached document before continuing.',
  retrySafe: false, recoveryAction: 'review_documents', documentsUploaded: 2,
};
const callback = desktopJobStatusSchema.parse({
  version: 1, jobId: 'job_upload_123456', callbackId: '0f5ce479-33d2-4929-aa5b-561d4a0fb923',
  occurredAt: '2026-11-03T14:14:50Z', eventType: 'result', status: 'FAILED_FINAL', result,
});
assert.deepEqual(callback.result?.documentFailure, documentFailure);
const metadata = readAutomationFailureMetadata(callback.result, 'FAILED_FINAL', 'documents');
assert.equal(metadata.documentFailure?.portalMessage, documentFailure.portalMessage);
assert.equal(metadata.documentFailure?.uploadedCount, 2);
assert.equal(metadata.retrySafe, false);

for (const patch of [{ uploadedCount: -1 }, { portalMessage: 'x'.repeat(501) }, { rawTraceback: 'private local path' }]) {
  assert.equal(desktopJobStatusSchema.safeParse({ ...callback, result: { ...callback.result, documentFailure: { ...documentFailure, ...patch } } }).success, false);
}

const context = {
  documentsHref: '/projects/test#documents', portalHref: 'https://www.edevelopment.scot/',
  client: null, site: null, applicationId: 'planning-test', typeOfWorkKeys: [], typeOfWorkOptions: [],
  agentDefaults: null, organisationName: 'Test practice', canManageAgentDefaults: false,
};
const html = renderToStaticMarkup(React.createElement(AutomationFailureRecovery, {
  metadata, context, applicationType: 'HOUSEHOLDER_PLANNING', retrying: false,
  onRetry: async () => {}, detailsHref: '/automation-jobs/test',
}));
assert.ok(html.includes('How to continue:'));
assert.ok(html.includes('Compare this file with the attached document'));
assert.ok(html.includes('View Householder'));
assert.ok(!html.includes('Retry application'));

const legacy = readAutomationFailureMetadata({ errorCode: 'DOCUMENT_UPLOAD_FAILED', nextAction: 'Review eBuilding Standards.' }, 'FAILED_FINAL', 'documents');
const legacyHtml = renderToStaticMarkup(React.createElement(AutomationFailureRecovery, {
  metadata: legacy, context, applicationType: 'HOUSEHOLDER_PLANNING', retrying: false,
  onRetry: async () => {}, detailsHref: '/automation-jobs/test',
}));
assert.equal(legacy.documentFailure, null);
assert.ok(legacyHtml.includes('existing ePlanning draft'));
assert.ok(!legacyHtml.includes('eBuilding Standards'));
assert.ok(!legacyHtml.includes('Retry application'));
console.log('document upload diagnostics tests passed');
