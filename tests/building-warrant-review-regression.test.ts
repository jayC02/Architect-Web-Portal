import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ApplicationDraftType, DocumentStatus, DocumentType } from '@prisma/client';
import { evaluateClientApplicationDraftReadiness } from '../src/lib/application-draft-readiness';
import { applicationDraftReviewSchema } from '../src/lib/validation/application-draft';
import {
  BUILDING_WARRANT_CONFIRMATION_DEFAULTS,
  buildingWarrantCertifierDetailsSchema,
} from '../src/lib/validation/domain';
import {
  mergeApplicationDraftConfirmationDefaults,
} from '../src/server/services/application-draft.service';

const expectedDefaults = {
  applicantIsOwner: true,
  applicationIsStaged: false,
  intendedLifeFiveYearsOrLess: false,
  fireAndRescueServiceEnforcingAuthority: true,
  listedBuildingOrConservationArea: false,
  otherHistoricalImportance: false,
  scottishMinistersRelaxationDirection: false,
  dangerousBuildingNotice: false,
  approvedCertifierOfConstruction: false,
  coveredBySTAS: false,
  restrictPublicInspection: false,
};

assert.deepEqual(
  BUILDING_WARRANT_CONFIRMATION_DEFAULTS,
  expectedDefaults,
  'Building Warrant review uses the established preparation-schema defaults',
);

const merged = mergeApplicationDraftConfirmationDefaults(ApplicationDraftType.BUILDING_WARRANT, {
  applicantIsOwner: false,
  applicationIsStaged: null,
  intendedLifeFiveYearsOrLess: '   ',
});
assert.equal(merged.applicantIsOwner, false, 'a user override wins over the preset');
assert.equal(merged.applicationIsStaged, false, 'a blank AI value cannot erase a deterministic default');
assert.equal(merged.intendedLifeFiveYearsOrLess, false, 'whitespace cannot erase a deterministic default');
assert.equal(merged.fireAndRescueServiceEnforcingAuthority, true);

assert.equal(
  buildingWarrantCertifierDetailsSchema.shape.description.parse('Roof'),
  'Roof',
  'a short non-empty Description of Work is accepted',
);
assert.throws(
  () => buildingWarrantCertifierDetailsSchema.shape.description.parse('   '),
  'Description of Work remains required',
);

const review = applicationDraftReviewSchema.parse({
  selectedApplicationType: ApplicationDraftType.BUILDING_WARRANT,
  projectMode: 'create',
  existingProjectId: null,
  project: {
    name: '1 Short Street, Glasgow, G1 1AA',
    internalReference: null,
    typeOfWorkKey: 'domestic_alteration_extension',
    summary: null,
  },
  siteMode: 'create',
  existingSiteId: null,
  site: {
    addressLine1: '1 Short Street',
    addressLine2: null,
    townCity: 'Glasgow',
    postcode: 'G1 1AA',
    country: 'United Kingdom',
    localAuthority: 'Glasgow City Council',
  },
  clientMode: 'create',
  existingClientId: null,
  client: {
    clientType: 'INDIVIDUAL',
    displayName: 'Ms Alex Example',
    title: 'Ms',
    firstName: 'Alex',
    lastName: 'Example',
    companyName: null,
    email: 'alex@example.com',
    phone: null,
    buildingNumber: '1',
    addressLine1: 'Short Street',
    addressLine2: null,
    townCity: 'Glasgow',
    postcode: 'G1 1AA',
    country: 'United Kingdom',
  },
  clientAddressSameAsSite: false,
  applicantDifferentFromClient: false,
  applicant: {
    clientType: 'INDIVIDUAL',
    displayName: 'Ms Alex Example',
    title: 'Ms',
    firstName: 'Alex',
    lastName: 'Example',
    companyName: null,
    email: 'alex@example.com',
    phone: null,
    buildingNumber: '1',
    addressLine1: 'Short Street',
    addressLine2: null,
    townCity: 'Glasgow',
    postcode: 'G1 1AA',
    country: 'United Kingdom',
  },
  agent: {
    practiceName: 'Example Architects',
    firstName: 'Agent',
    lastName: 'Example',
    email: 'agent@example.com',
    phone: null,
    buildingNumber: '2',
    addressLine1: 'Practice Street',
    addressLine2: null,
    townCity: 'Glasgow',
    postcode: 'G2 2BB',
    country: 'United Kingdom',
    saveAsOrganisationDefault: false,
  },
  application: {
    description: 'Roof',
    currentUse: 'Dwelling',
    proposedUse: 'Dwelling',
    estimatedValue: 1000,
    presetKey: 'domestic_alteration_extension',
    typeOfWorkKeys: ['domestic_alteration_extension'],
    selectedCertifierPresetId: null,
  },
  confirmations: BUILDING_WARRANT_CONFIRMATION_DEFAULTS,
  documents: [{
    id: 'location-plan',
    documentType: DocumentType.LOCATION_PLAN,
    documentStatus: DocumentStatus.APPROVED,
    revision: null,
    drawingNumber: null,
    drawingTitle: null,
  }],
});

assert.equal(review.client.firstName, 'Alex', 'prepared Client values remain intact');
assert.ok(
  !evaluateClientApplicationDraftReadiness(review).some((issue) => issue.key === 'application.description'),
  'short non-empty descriptions are ready on the client',
);
assert.ok(
  !evaluateClientApplicationDraftReadiness(review).some((issue) => issue.section === 'confirmations'),
  'valid preset confirmations do not show Choose and confirm errors',
);
assert.ok(
  evaluateClientApplicationDraftReadiness({
    ...review,
    confirmations: { ...review.confirmations, coveredBySTAS: null },
  }).some((issue) => issue.key === 'confirmations.coveredBySTAS'),
  'a genuinely missing confirmation still requires review',
);

const reviewUi = fs.readFileSync('src/components/applications/ApplicationDraftReview.tsx', 'utf8');
const clientSection = reviewUi.slice(
  reviewUi.indexOf('title="Client and applicant"'),
  reviewUi.indexOf('title="Agent and practice"'),
);
const confirmationSection = reviewUi.slice(
  reviewUi.indexOf('title="Confirmations"'),
  reviewUi.indexOf('panel sticky bottom'),
);
assert.match(clientSection, /Client and applicant relationship/);
assert.match(reviewUi, /Identity and contact/);
assert.match(reviewUi, /Address details/);
assert.match(clientSection, /<PersonFields[\s\S]*prefix="client"/);
assert.match(clientSection, /Client is also the applicant/);
assert.match(clientSection, /Client address is the same as the site address/);
assert.doesNotMatch(clientSection, /EvidenceList|View source evidence/);
assert.doesNotMatch(confirmationSection, /EvidenceList|View source evidence/);
assert.match(confirmationSection, /Application declarations prepared/);

const commitService = fs.readFileSync('src/server/services/application-draft-commit.service.ts', 'utf8');
const snapshotService = fs.readFileSync('src/server/services/automation-jobs.service.ts', 'utf8');
assert.match(commitService, /applicantIsOwner: review\.confirmations\.applicantIsOwner/);
assert.match(commitService, /restrictPublicInspection: review\.confirmations\.restrictPublicInspection/);
assert.match(commitService, /preparationData: buildingWarrantAnswers\(review\)/);
assert.match(snapshotService, /unusualAnswers: warrantAnswers/);

console.log('Building Warrant review regression tests passed');
