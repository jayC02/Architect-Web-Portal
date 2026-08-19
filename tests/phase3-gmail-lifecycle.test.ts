import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DocumentSortSource,
  DocumentType,
  GmailPlanningClassification,
  PlanningStatus,
  type PrismaClient,
} from '@prisma/client';
import {
  classifyPlanningEmail,
  decideAutomaticPlanningTransition,
  gmailPlanningIdempotencyKey,
  hasExpectedAuthorityEvidence,
} from '../src/server/services/gmail-planning-classifier.service';
import {
  ingestGmailProjectDocument,
  isLikelyDecisionNoticeAttachment,
} from '../src/server/services/gmail-document-ingestion.service';

const sentAt = new Date('2026-08-17T09:00:00.000Z');
const email = (subject: string, text: string) => ({ subject, text, excerpt: text, sentAt });

assert.equal(classifyPlanningEmail(email('Application received', 'We have received your planning application.')).classification, GmailPlanningClassification.APPLICATION_RECEIVED);
assert.equal(classifyPlanningEmail(email('Planning validation', 'Your planning application has been validated.')).classification, GmailPlanningClassification.APPLICATION_VALIDATED);
assert.equal(classifyPlanningEmail(email('Planning update', 'Further information is required. Please provide the following drawings.')).classification, GmailPlanningClassification.INFORMATION_REQUESTED);
assert.equal(classifyPlanningEmail(email('Decision', 'Planning permission is hereby granted.')).classification, GmailPlanningClassification.DECISION_APPROVED);
assert.equal(classifyPlanningEmail(email('Decision', 'Planning permission has been refused.')).classification, GmailPlanningClassification.DECISION_REFUSED);
assert.equal(classifyPlanningEmail(email('Hello', 'A general account message.')).classification, GmailPlanningClassification.UNKNOWN);
assert.equal(classifyPlanningEmail(email('Committee report', 'The officer recommendation is that planning permission may be approved.')).classification, GmailPlanningClassification.DECISION_OTHER);

const approval = classifyPlanningEmail(email('26/01234/FUL — decision', 'Glasgow City Council confirms planning permission is hereby granted.'));
const strongPolicy = decideAutomaticPlanningTransition({
  classification: approval,
  currentStatus: PlanningStatus.IN_REVIEW,
  uniqueProjectMatch: true,
  exactApplicationReference: true,
  expectedAuthority: true,
  newerManualState: false,
});
assert.equal(strongPolicy.automatic, true, 'all deterministic gates permit automatic approval');
assert.equal(strongPolicy.targetStatus, PlanningStatus.APPROVED);

for (const unsafe of [
  { exactApplicationReference: false },
  { uniqueProjectMatch: false },
  { expectedAuthority: false },
  { newerManualState: true },
]) {
  assert.equal(decideAutomaticPlanningTransition({
    classification: approval,
    currentStatus: PlanningStatus.IN_REVIEW,
    uniqueProjectMatch: true,
    exactApplicationReference: true,
    expectedAuthority: true,
    newerManualState: false,
    ...unsafe,
  }).automatic, false);
}
assert.equal(decideAutomaticPlanningTransition({
  classification: approval,
  currentStatus: PlanningStatus.WITHDRAWN,
  uniqueProjectMatch: true,
  exactApplicationReference: true,
  expectedAuthority: true,
  newerManualState: false,
}).automatic, false, 'terminal/manual state cannot regress');
assert.equal(decideAutomaticPlanningTransition({
  classification: approval,
  currentStatus: PlanningStatus.IN_REVIEW,
  uniqueProjectMatch: true,
  exactApplicationReference: true,
  expectedAuthority: true,
  newerManualState: false,
  aiClassification: GmailPlanningClassification.DECISION_REFUSED,
}).automatic, false, 'AI disagreement forces review');

assert.equal(hasExpectedAuthorityEvidence({
  sender: 'planning@glasgow.gov.uk',
  localAuthority: 'Glasgow City Council',
  content: 'Glasgow planning decision',
}), true);
assert.equal(hasExpectedAuthorityEvidence({
  sender: 'agent@example.test',
  localAuthority: 'Glasgow City Council',
  content: 'Glasgow planning decision',
}), false, 'unknown sender is never authoritative by AI/content alone');
assert.equal(
  gmailPlanningIdempotencyKey('message-1', 'planning-1', GmailPlanningClassification.DECISION_APPROVED),
  gmailPlanningIdempotencyKey('message-1', 'planning-1', GmailPlanningClassification.DECISION_APPROVED),
);

assert.equal(isLikelyDecisionNoticeAttachment({ fileName: 'Decision Notice.pdf', mimeType: 'application/pdf', subject: 'Approved' }), true);
assert.equal(isLikelyDecisionNoticeAttachment({ fileName: 'drawing.pdf', mimeType: 'application/pdf', subject: 'Revised drawing' }), false);

let classifierCalls = 0;
let createdBatchData: any = null;
let attachmentUpdate: any = null;
let activityCreate: any = null;
const transaction = {
  documentSortBatch: {
    create: async ({ data }: any) => {
      createdBatchData = data;
      return { id: 'batch-1', items: [{ documentId: 'document-1' }] };
    },
  },
  gmailAttachment: { update: async ({ data }: any) => { attachmentUpdate = data; } },
  projectActivity: { upsert: async ({ create }: any) => { activityCreate = create; return create; } },
};
const database: any = {
  gmailAttachment: {
    findFirst: async () => ({ id: 'attachment-row', importedDocumentId: null }),
    update: async () => null,
  },
  projectDocument: { findFirst: async () => null },
  project: {
    findFirst: async () => ({
      id: 'project-1', name: '73 Blackhill Drive', projectType: 'Extension', stage: 'PLANNING',
      siteAddress: '73 Blackhill Drive', localAuthority: 'Glasgow City Council', notes: null,
      site: null, client: { name: 'Client' },
    }),
  },
  $transaction: async (callback: any) => callback(transaction),
};
const suggestion = {
  originalFilename: 'decision-notice.pdf',
  suggestedDocumentType: DocumentType.CORRESPONDENCE,
  confidence: 0.96,
  reason: 'Matched planning decision notice.',
  matchedRules: ['CORRESPONDENCE:decision notice:112'],
  revision: null,
  drawingNumber: null,
  drawingTitle: 'Planning Decision Notice',
  source: DocumentSortSource.RULES,
  isLikelyCurrent: true,
  suitableForPlanning: true,
  suitableForBuildingWarrant: false,
};
const imported = await ingestGmailProjectDocument({
  organisationId: 'org-1',
  projectId: 'project-1',
  trackedEmailId: 'email-1',
  gmailAttachmentId: 'attachment-row',
  gmailMessageId: 'message-1',
  filename: 'decision-notice.pdf',
  mimeType: 'application/pdf',
  bytes: Buffer.from('%PDF test'),
  initiatedByUserId: 'user-1',
  decisionNotice: true,
}, {
  database: database as PrismaClient,
  save: (async () => ({
    fileName: 'stored.pdf', storageUrl: '/uploads/stored.pdf', storageKey: 'stored.pdf',
    mimeType: 'application/pdf', sizeBytes: 9,
  })) as any,
  classify: (async () => { classifierCalls += 1; return [suggestion]; }) as any,
});
assert.equal(imported.documentId, 'document-1');
assert.equal(classifierCalls, 1, 'existing project PDF classifier is called');
assert.equal(createdBatchData.status, 'NEEDS_REVIEW');
assert.equal(createdBatchData.items.create.document.create.status, 'IN_REVIEW', 'uncertain/automatic imports remain reviewable');
assert.match(createdBatchData.items.create.document.create.notes, /Imported from Gmail/);
assert.equal(attachmentUpdate.importedDocumentId, 'document-1');
assert.equal(activityCreate.sourceId, 'email-1');

let duplicateClassifierCalls = 0;
const duplicateDatabase: any = {
  gmailAttachment: {
    findFirst: async () => ({ id: 'attachment-row-2', importedDocumentId: null }),
    update: async () => null,
  },
  projectDocument: { findFirst: async () => ({ id: 'existing-document' }) },
};
const duplicate = await ingestGmailProjectDocument({
  organisationId: 'org-1', projectId: 'project-1', trackedEmailId: 'email-2',
  gmailAttachmentId: 'attachment-row-2', gmailMessageId: 'message-2', filename: 'copy.pdf',
  mimeType: 'application/pdf', bytes: Buffer.from('%PDF test'), initiatedByUserId: 'user-1',
}, {
  database: duplicateDatabase as PrismaClient,
  classify: (async () => { duplicateClassifierCalls += 1; return [suggestion]; }) as any,
});
assert.equal(duplicate.documentId, 'existing-document');
assert.equal(duplicate.duplicateByHash, true);
assert.equal(duplicateClassifierCalls, 0, 'hash duplicates do not invoke or bypass the classifier');

const lifecycleSource = fs.readFileSync(new URL('../src/server/services/gmail-planning-lifecycle.service.ts', import.meta.url), 'utf8');
const syncSource = fs.readFileSync(new URL('../src/server/services/gmail-sync.service.ts', import.meta.url), 'utf8');
const cronSource = fs.readFileSync(new URL('../src/pages/api/cron/gmail-sync.ts', import.meta.url), 'utf8');
assert.match(lifecycleSource, /updatePlanningApplicationInTransaction/, 'Gmail status changes use the lifecycle boundary');
assert.doesNotMatch(lifecycleSource, /google-calendar|syncDeadlineToGoogle/, 'Gmail approval never calls Google Calendar directly');
assert.match(syncSource, /gmailHistoryId: failed \? startingHistoryId : proposedHistoryId/, 'cursor advances only after durable processing');
assert.match(syncSource, /GMAIL_SYNC_ORGANISATION_LIMIT/, 'daily scheduling bounds tenant work');
assert.match(cronSource, /syncAllEnabledGmailConnections/, 'the existing Gmail cron is reused');

console.log('phase 3 Gmail lifecycle tests passed');
