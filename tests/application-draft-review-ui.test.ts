import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ApplicationDraftType, DocumentStatus, DocumentType } from '@prisma/client';
import { evaluateClientApplicationDraftReadiness } from '../src/lib/application-draft-readiness';
import { applicationDraftReviewSchema } from '../src/lib/validation/application-draft';

const read = (file: string) => fs.readFileSync(file, 'utf8');
const reviewUi = read('src/components/applications/ApplicationDraftReview.tsx');
const draftService = read('src/server/services/application-draft.service.ts');
const draftValidation = read('src/lib/validation/application-draft.ts');
const commitRoute = read('src/pages/api/application-drafts/[id]/commit.ts');

const review = applicationDraftReviewSchema.parse({
  selectedApplicationType: ApplicationDraftType.HOUSEHOLDER_PLANNING,
  projectMode: 'create',
  existingProjectId: null,
  project: { name: 'Example project', internalReference: null, typeOfWorkKey: null, summary: null },
  siteMode: 'create',
  existingSiteId: null,
  site: {
    buildingNumber: '1', addressLine1: 'Example Street', addressLine2: null, townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom', localAuthority: 'Glasgow City Council',
  },
  clientMode: 'create',
  existingClientId: null,
  client: {
    clientType: 'INDIVIDUAL', displayName: 'Alex Example', title: 'Ms', firstName: 'Alex', lastName: 'Example', companyName: null,
    email: 'alex@example.com', phone: null, buildingNumber: '1', addressLine1: 'Example Street', addressLine2: null, townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom',
  },
  clientAddressSameAsSite: true,
  applicantDifferentFromClient: false,
  agent: {
    practiceName: 'Example Practice', firstName: 'Agent', lastName: 'Example', email: 'agent@example.com', phone: null, buildingNumber: '2',
    addressLine1: '2 Practice Street', addressLine2: null, townCity: 'Glasgow', postcode: 'G2 2BB', country: 'United Kingdom', saveAsOrganisationDefault: false,
  },
  application: { description: 'A specific description of proposed work.', currentUse: null, proposedUse: null, estimatedValue: null, presetKey: null, selectedCertifierPresetId: null },
  confirmations: { discussedWithPlanningAuthority: false, treesOnOrAdjacentToSite: false, newOrAlteredVehicleAccess: false, soleOwner: true, agriculturalHolding: false },
  documents: [{ id: 'location-plan', documentType: DocumentType.LOCATION_PLAN, documentStatus: DocumentStatus.APPROVED, revision: null, drawingNumber: null, drawingTitle: null }],
});

assert.deepEqual(evaluateClientApplicationDraftReadiness(review), [], 'complete local review is ready immediately');
const autoRouteReview = { ...review, selectedApplicationType: ApplicationDraftType.AUTO };
assert.ok(
  !evaluateClientApplicationDraftReadiness(autoRouteReview).some((issue) => issue.key === 'selectedApplicationType'),
  'automatic application routing is not shown as a missing user field',
);
const missingName = { ...review, project: { ...review.project, name: null } };
assert.ok(evaluateClientApplicationDraftReadiness(missingName).some((issue) => issue.key === 'project.name'));
const restoredName = { ...missingName, project: { ...missingName.project, name: 'Restored project name' } };
assert.ok(!evaluateClientApplicationDraftReadiness(restoredName).some((issue) => issue.key === 'project.name'), 'correcting text removes attention without a save response');
const needsDocumentReview = { ...review, documents: [{ ...review.documents[0], documentStatus: DocumentStatus.IN_REVIEW }] };
assert.ok(evaluateClientApplicationDraftReadiness(needsDocumentReview).some((issue) => issue.key === 'documents.location-plan'));
const duplicateLocationPlan = { ...review, documents: [...review.documents, { ...review.documents[0], id: 'location-plan-2' }] };
assert.ok(evaluateClientApplicationDraftReadiness(duplicateLocationPlan).some((issue) => issue.key === 'documents.locationPlan'), 'multiple Location Plans still need deliberate resolution');

assert.match(draftValidation, /clientAddressSameAsSite: z\.boolean\(\)\.default\(false\)/, 'address relationship is persisted in the existing draft JSON');
assert.match(draftService, /soleOwner: true/, 'Planning and Householder sole-owner default is Yes');
assert.match(draftService, /agriculturalHolding: false/, 'Planning and Householder agricultural-holding default is No');
assert.doesNotMatch(reviewUi, />Application route</, 'application route is not shown inside Project creation');
assert.match(reviewUi, /Select every type that applies to this warrant/, 'type of work is presented as a multi-select warrant detail');
assert.match(reviewUi, /type="checkbox"[\s\S]*toggleTypeOfWork/, 'each warrant type can be selected independently');

assert.match(reviewUi, /const acceptDocument/, 'review-required documents have a one-click accept handler');
assert.match(reviewUi, /documentStatus: 'APPROVED'/, 'accepting marks the document reviewed');
assert.match(reviewUi, />Accept</, 'review-required rows expose Accept');
assert.match(reviewUi, />Change</, 'review-required rows expose Change');
assert.match(reviewUi, />\s*Cancel\s*</, 'category changes can be cancelled');
assert.match(reviewUi, /More than one document is marked as a Location Plan/, 'Location Plan conflicts explain the required manual choice');
assert.match(reviewUi, /clientAddressSameAsSite/, 'same-as-site address flow is visible');
assert.match(reviewUi, /withSiteAddress[\s\S]*buildingNumber: site\.buildingNumber/, 'same-as-site copies the structured Site building number');
assert.match(reviewUi, /showAddress \? <section[\s\S]*Address details/, 'same-as-site hides the duplicate Client address section');
assert.match(reviewUi, /label="Building number"[\s\S]*review\.site\.buildingNumber/, 'Site asks for the building number once');
assert.match(reviewUi, /Use a different applicant/, 'different applicant remains a secondary action');
assert.match(reviewUi, /persistCurrentReview/, 'draft updates are autosaved');
assert.match(reviewUi, /window\.setTimeout\(\(\) => void persistCurrentReview\(\), 600\)/, 'text updates are debounced');
assert.match(reviewUi, /saveImmediately\.current/, 'discrete changes save immediately');
assert.match(reviewUi, /previousIssueCount/, 'sections stay open when a field becomes valid while typing');
assert.match(reviewUi, /Create Project/, 'one clear completion action remains');
assert.doesNotMatch(reviewUi, /Save application draft|Create and open in desktop/, 'old competing actions are removed');
assert.match(commitRoute, /const projectUrl = `\/projects\/\$\{encodeURIComponent\(result\.projectId\)\}`/, 'commit still builds a redirect to the resulting Project');
assert.match(commitRoute, /redirectTo,/, 'commit returns the resulting Project redirect');

console.log('application draft review UI tests passed');
