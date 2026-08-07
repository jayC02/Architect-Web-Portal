import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ApplicationDraftType, DocumentStatus, DocumentType } from '@prisma/client';
import { evaluateClientApplicationDraftReadiness } from '../src/lib/application-draft-readiness';
import { applicationDraftReviewSchema } from '../src/lib/validation/application-draft';

const reviewUi = readFileSync('src/components/applications/ApplicationDraftReview.tsx', 'utf8');
const draftService = readFileSync('src/server/services/application-draft.service.ts', 'utf8');

const review = applicationDraftReviewSchema.parse({
  selectedApplicationType: ApplicationDraftType.HOUSEHOLDER_PLANNING,
  projectMode: 'create', existingProjectId: null,
  project: { name: '1 Example Street', internalReference: null, typeOfWorkKey: null, summary: null },
  siteMode: 'create', existingSiteId: null,
  site: { addressLine1: '1 Example Street', addressLine2: null, townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom', localAuthority: 'Glasgow City Council' },
  clientMode: 'create', existingClientId: null,
  client: { clientType: 'INDIVIDUAL', displayName: 'Alex Example', title: null, firstName: 'Alex', lastName: 'Example', companyName: null, email: 'alex@example.com', phone: null, addressLine1: '1 Example Street', addressLine2: null, townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom' },
  clientAddressSameAsSite: true,
  applicantDifferentFromClient: false,
  agent: { practiceName: 'Example Practice', firstName: 'Agent', lastName: 'Example', email: 'agent@example.com', phone: null, buildingNumber: '2', addressLine1: '2 Practice Street', addressLine2: null, townCity: 'Glasgow', postcode: 'G2 2BB', country: 'United Kingdom', saveAsOrganisationDefault: false },
  application: { description: 'A specific description of proposed work.', currentUse: null, proposedUse: null, estimatedValue: null, presetKey: null, typeOfWorkKeys: [], selectedCertifierPresetId: null },
  confirmations: { discussedWithPlanningAuthority: false, treesOnOrAdjacentToSite: false, newOrAlteredVehicleAccess: false, soleOwner: true, agriculturalHolding: false },
  documents: [{ id: 'location-plan', documentType: DocumentType.LOCATION_PLAN, documentStatus: DocumentStatus.APPROVED, revision: null, drawingNumber: null, drawingTitle: null }],
});

assert.ok(evaluateClientApplicationDraftReadiness(review).some((issue) => issue.key === 'client.title'), 'an individual title is mandatory');
assert.ok(!evaluateClientApplicationDraftReadiness({ ...review, client: { ...review.client, title: 'Other' } }).some((issue) => issue.key === 'client.title'), 'Other satisfies title readiness');
assert.match(reviewUi, /Title <span aria-hidden="true">\*<\/span>[\s\S]*?<select[\s\S]*?required/, 'the title select is visibly and natively required');
assert.match(draftService, /suggestionFromFacts\(facts, 'applicant\.title', 'Other'\)/, 'missing analysed titles default to Other');
assert.match(draftService, /withDefaultIndividualTitle\(existingReview\.data\.applicant \?\? existingReview\.data\.client\)/, 'reopened drafts also receive the safe title default');

console.log('application title default tests passed');
