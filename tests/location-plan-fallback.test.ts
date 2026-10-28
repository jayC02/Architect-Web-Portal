import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AutomationJobType, DocumentStatus, DocumentType } from '@prisma/client';
import { hasLocationPlanDocument, resolveLocationPlans } from '../src/lib/location-plan';
import { evaluateClientApplicationDraftReadiness } from '../src/lib/application-draft-readiness';
import { evaluateApplicationDraftReadiness } from '../src/server/services/application-draft.service';
import { evaluateAutomationPreflight } from '../src/server/services/automation-preflight.service';
import { buildAutomationJobSnapshot } from '../src/server/services/automation-jobs.service';
import { buildApplicationPreparationDraft } from '../src/server/services/application-preparation.service';
import { prisma } from '../src/lib/db/prisma';
import { clientReviewFixture } from './fixtures/client-applicant-review';

// Real service functions and schemas, using local records; no database connection.
const fixture = JSON.parse(readFileSync('tests/fixtures/automation-job-v2-building-warrant.json', 'utf8'));
for (const type of [DocumentType.SITE_PLAN, DocumentType.BLOCK_PLAN]) {
  const review = structuredClone(clientReviewFixture().review!);
  review.documents[0].documentType = type;
  for (const evaluate of [evaluateClientApplicationDraftReadiness, evaluateApplicationDraftReadiness]) {
    assert.equal(evaluate(review).filter(issue => issue.section === 'documents').length, 0, `${type} satisfies location readiness`);
    const pending = structuredClone(review);
    pending.documents[0].documentStatus = DocumentStatus.IN_REVIEW;
    assert.ok(evaluate(pending).some(issue => issue.key === `documents.${pending.documents[0].id}`), 'fallback still requires review');
    const conflict = structuredClone(review);
    conflict.documents.push(...['explicit-1', 'explicit-2'].map(id => ({ ...review.documents[0], id, documentType: DocumentType.LOCATION_PLAN })));
    assert.ok(evaluate(conflict).some(issue => issue.key === 'documents.locationPlan'), 'fallback cannot hide conflicting explicit location plans');
  }
  const snapshot = structuredClone(fixture);
  snapshot.documents[0].categoryKey = type;
  assert.equal(evaluateAutomationPreflight(snapshot).locationPlanStatus, 'REVIEWED');
  assert.ok(!evaluateAutomationPreflight(snapshot).missing.some(issue => issue.field === 'documents.locationPlan'));
  snapshot.documents[0].reviewState = DocumentStatus.DRAFT;
  assert.equal(evaluateAutomationPreflight(snapshot).locationPlanStatus, 'PRESENT_UNREVIEWED');
}
const candidates = [{ id: 'site', type: 'SITE_PLAN' }, { id: 'block', type: 'BLOCK_PLAN' }];
assert.equal(resolveLocationPlans(candidates, doc => doc.type)[0].id, 'site');
assert.equal(resolveLocationPlans([...candidates, { id: 'location', type: 'LOCATION_PLAN' }], doc => doc.type)[0].id, 'location');
assert.deepEqual(resolveLocationPlans([{ type: 'PROPOSED_DRAWING' }, { type: 'OTHER' }], doc => doc.type), [], 'ordinary plans never fill this role');

// Project warnings and next actions distinguish missing from awaiting review.
for (const type of [DocumentType.LOCATION_PLAN, DocumentType.SITE_PLAN, DocumentType.BLOCK_PLAN]) {
  for (const status of [DocumentStatus.APPROVED, DocumentStatus.DRAFT, DocumentStatus.IN_REVIEW]) {
    assert.equal(hasLocationPlanDocument([{ type, status }]), true, `${type}/${status} is present; readiness still checks review separately`);
  }
  for (const status of [DocumentStatus.REJECTED, DocumentStatus.SUPERSEDED]) {
    assert.equal(hasLocationPlanDocument([{ type, status }]), false, `${type}/${status} cannot satisfy presence`);
  }
}
assert.equal(hasLocationPlanDocument([]), false);
assert.equal(hasLocationPlanDocument([{ type: 'PROPOSED_DRAWING', status: 'APPROVED' }]), false);
assert.equal(hasLocationPlanDocument([
  { type: 'LOCATION_PLAN', status: 'SUPERSEDED' }, { type: 'SITE_PLAN', status: 'APPROVED' },
]), true, 'an inactive explicit record must not hide an available fallback');

const now = new Date('2026-10-22T12:00:00Z');
const review = clientReviewFixture().review!;
let documents: any[] = [];
const project = {
  ...fixture.project, projectType: 'domestic_alteration_extension', updatedAt: now,
  site: { id: 'site', ...review.site, updatedAt: now },
  client: { id: 'client', name: review.client.displayName, ...review.client, updatedAt: now },
};
const defaults = {
  practiceName: review.agent.practiceName, agentFirstName: review.agent.firstName, agentLastName: review.agent.lastName,
  agentEmail: review.agent.email, agentBuildingNumber: review.agent.buildingNumber,
  agentAddressLine1: review.agent.addressLine1, agentTownCity: review.agent.townCity, agentPostcode: review.agent.postcode, updatedAt: now,
};
const planning = { id: 'planning', description: 'Proposed extension.', status: 'DRAFTING', updatedAt: now, preparationData: { soleOwner: true, agriculturalHolding: false, applicationFee: 350 } };
const database: any = {
  project: { findFirst: async () => project }, organisationDefaults: { findUnique: async () => defaults },
  planningApplication: { findFirst: async () => planning }, buildingWarrantApplication: { findFirst: async () => null },
  projectDocument: { findMany: async () => documents },
};
const makeDocument = (id: string, type: DocumentType) => ({
  id, type, status: DocumentStatus.APPROVED, fileName: `${id}.pdf`, originalName: `${id}.pdf`, mimeType: 'application/pdf', sizeBytes: 12,
  drawingTitle: null, drawingNumber: null, revision: null, sortSource: 'MANUAL', sortConfidence: 1, updatedAt: now, analysisStatus: 'SUCCESS', analysisResult: null,
});
let built: Awaited<ReturnType<typeof buildAutomationJobSnapshot>>;
for (const type of [DocumentType.SITE_PLAN, DocumentType.BLOCK_PLAN]) {
  documents = [makeDocument('fallback', type), makeDocument('supporting', DocumentType.PROPOSED_DRAWING)];
  built = await buildAutomationJobSnapshot({ organisationId: 'org', organisationName: 'Test', projectId: project.id, type: AutomationJobType.HOUSEHOLDER_PLANNING, createdBy: { id: 'user', name: 'Tester', email: 'tester@example.test' } }, database);
  assert.equal(built.preflight.status, 'READY');
  assert.equal(built.dataSnapshot.documents[0].categoryKey, type, 'reviewed classification is preserved');
  assert.equal(built.dataSnapshot.documents[0].required, true, 'chosen fallback is a required download');
  assert.equal(built.dataSnapshot.documents[1].required, false);
}
documents = [makeDocument('site', DocumentType.SITE_PLAN), makeDocument('explicit', DocumentType.LOCATION_PLAN)];
const explicit = await buildAutomationJobSnapshot({ organisationId: 'org', organisationName: 'Test', projectId: project.id, type: AutomationJobType.HOUSEHOLDER_PLANNING, createdBy: { id: 'user', name: 'Tester', email: 'tester@example.test' } }, database);
assert.deepEqual(explicit.dataSnapshot.documents.filter(doc => doc.required).map(doc => doc.id), ['explicit']);

// Preparation must agree with snapshot/readiness for already saved projects.
const originalJobRead = prisma.automationJob.findFirst;
const originalDocumentRead = prisma.projectDocument.findMany;
try {
  (prisma.automationJob as any).findFirst = async () => ({ type: 'HOUSEHOLDER_PLANNING', projectId: project.id, project, dataSnapshot: built!.dataSnapshot });
  (prisma.projectDocument as any).findMany = async () => documents;
  documents = [makeDocument('site', DocumentType.SITE_PLAN)];
  const prepared = await buildApplicationPreparationDraft('job', 'org');
  assert.equal(prepared.documentSummary.locationPlanDocumentId, 'site');
  assert.deepEqual(prepared.documentSummary.missingLikelyDocumentTypes, []);
  assert.deepEqual(prepared.documentSummary.unresolvedClassifications, []);
} finally {
  prisma.automationJob.findFirst = originalJobRead;
  prisma.projectDocument.findMany = originalDocumentRead;
}
console.log('Location-plan fallback: browser/server readiness, review gates, preflight, real snapshot and preparation services passed');
