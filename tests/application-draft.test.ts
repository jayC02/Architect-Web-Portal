import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ApplicationDraftType,
  DocumentStatus,
  DocumentType,
} from '@prisma/client';
import { applicationDraftReviewSchema } from '../src/lib/validation/application-draft';
import {
  evaluateApplicationDraftReadiness,
} from '../src/server/services/application-draft.service';
import {
  scoreClientMatch,
  scoreProjectMatch,
  scoreSiteMatch,
} from '../src/server/services/application-draft-matching.service';

const buildingConfirmations = {
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

const completeBuildingReview = applicationDraftReviewSchema.parse({
  selectedApplicationType: ApplicationDraftType.BUILDING_WARRANT,
  projectMode: 'create',
  existingProjectId: null,
  project: {
    name: '105 Ralston Avenue',
    buildingUse: 'residential',
    internalReference: '24-101',
    typeOfWorkKey: 'domestic_alteration_extension',
    summary: 'Domestic extension and internal alterations.',
  },
  siteMode: 'create',
  existingSiteId: null,
  site: {
    buildingNumber: '105',
    addressLine1: '105 Ralston Avenue',
    addressLine2: null,
    townCity: 'Glasgow',
    postcode: 'G52 3QH',
    country: 'United Kingdom',
    localAuthority: 'Glasgow City Council',
  },
  clientMode: 'create',
  existingClientId: null,
  client: {
    clientType: 'INDIVIDUAL',
    displayName: 'Ms Laura MacDonald',
    title: 'Ms',
    firstName: 'Laura',
    lastName: 'MacDonald',
    companyName: null,
    email: 'laura@example.com',
    phone: '07123 456789',
    buildingNumber: '105',
    addressLine1: '105 Ralston Avenue',
    addressLine2: null,
    townCity: 'Glasgow',
    postcode: 'G52 3QH',
    country: 'United Kingdom',
  },
  applicantDifferentFromClient: false,
  agent: {
    practiceName: 'Ninety One Architects',
    firstName: 'Jay',
    lastName: 'Chall',
    email: 'practice@example.com',
    phone: '0141 000 0000',
    buildingNumber: '1',
    addressLine1: '1 Practice Street',
    addressLine2: null,
    townCity: 'Glasgow',
    postcode: 'G1 1AA',
    country: 'United Kingdom',
    saveAsOrganisationDefault: false,
  },
  application: {
    description: 'Construct a single-storey rear extension and complete associated internal alterations.',
    currentUse: 'Domestic dwelling',
    proposedUse: 'Domestic dwelling',
    estimatedValue: 45_000,
    presetKey: 'domestic_alteration_extension',
    typeOfWorkKeys: ['domestic_alteration_extension', 'demolition'],
    selectedCertifierPresetId: null,
  },
  confirmations: buildingConfirmations,
  documents: [{
    id: 'document-location',
    documentType: DocumentType.LOCATION_PLAN,
    documentStatus: DocumentStatus.APPROVED,
    revision: 'A',
    drawingNumber: 'L(0-)00',
    drawingTitle: 'Location Plan',
  }],
});

assert.deepEqual(
  evaluateApplicationDraftReadiness(completeBuildingReview),
  [],
  'a fully reviewed Building Warrant draft is ready to commit',
);
assert.ok(
  !evaluateApplicationDraftReadiness({
    ...completeBuildingReview,
    selectedApplicationType: ApplicationDraftType.AUTO,
  }).some((issue) => issue.key === 'selectedApplicationType'),
  'automatic application routing is not a server-side readiness requirement',
);
assert.deepEqual(
  completeBuildingReview.application.typeOfWorkKeys,
  ['domestic_alteration_extension', 'demolition'],
  'Building Warrant review preserves every selected type of work',
);

const oneUnconfirmedBuildingAnswer = {
  ...completeBuildingReview,
  confirmations: {
    ...completeBuildingReview.confirmations,
    applicantIsOwner: null,
  },
};
const buildingIssues = evaluateApplicationDraftReadiness(oneUnconfirmedBuildingAnswer);
assert.deepEqual(buildingIssues, [], 'Building Warrant answers are confirmed on the warrant details page, not in the draft review');

const householderReview = applicationDraftReviewSchema.parse({
  ...completeBuildingReview,
  selectedApplicationType: ApplicationDraftType.HOUSEHOLDER_PLANNING,
  project: {
    ...completeBuildingReview.project,
    typeOfWorkKey: 'domestic_alteration_extension',
  },
  application: {
    ...completeBuildingReview.application,
    currentUse: null,
    proposedUse: null,
    estimatedValue: null,
    presetKey: null,
    typeOfWorkKeys: [],
  },
  confirmations: {
    applicationFee: 325.50,
    discussedWithPlanningAuthority: false,
    treesOnOrAdjacentToSite: false,
    newOrAlteredVehicleAccess: false,
    soleOwner: null,
    agriculturalHolding: null,
  },
});
const householderIssues = evaluateApplicationDraftReadiness(householderReview);
assert.deepEqual(
  householderIssues.map((issue) => issue.key).sort(),
  ['confirmations.agriculturalHolding', 'confirmations.soleOwner'],
  'Householder readiness asks only its route-specific unresolved legal confirmations',
);
assert.ok(
  !householderIssues.some((issue) => issue.key.includes('currentUse') || issue.key.includes('estimatedValue')),
  'Householder does not inherit Building Warrant-only requirements',
);

const parkingIssues = evaluateApplicationDraftReadiness({
  ...householderReview,
  confirmations: {
    ...householderReview.confirmations,
    soleOwner: true,
    agriculturalHolding: false,
    newOrAlteredVehicleAccess: true,
  },
});
assert.deepEqual(
  parkingIssues.map((issue) => issue.key).sort(),
  ['confirmations.currentParkingSpaces', 'confirmations.proposedParkingSpaces'],
  'parking counts become required only when vehicle access is confirmed',
);

const duplicateLocationIssues = evaluateApplicationDraftReadiness({
  ...completeBuildingReview,
  documents: [
    ...completeBuildingReview.documents,
    { ...completeBuildingReview.documents[0], id: 'second-location' },
  ],
});
assert.ok(
  duplicateLocationIssues.some((issue) => issue.key === 'documents.locationPlan'),
  'exactly one Location Plan must be reviewed',
);

const clientCandidate = {
  id: 'client-1',
  name: 'Laura MacDonald',
  email: 'laura@example.com',
  phone: '07123 456789',
  companyName: null,
  firstName: 'Laura',
  lastName: 'MacDonald',
  address: '105 Ralston Avenue, Glasgow, G52 3QH',
  addressLine1: '105 Ralston Avenue',
  townCity: 'Glasgow',
  postcode: 'G52 3QH',
};
assert.equal(
  scoreClientMatch(clientCandidate, { email: 'LAURA@example.com' })?.strength,
  'strong',
  'normalised email produces a strong client match',
);
assert.equal(
  scoreClientMatch(clientCandidate, { phone: '+44 7123 456789' })?.strength,
  'possible',
  'UK phone formats are normalised for matching',
);
assert.equal(
  scoreClientMatch(clientCandidate, { lastName: 'MacDonald' }),
  null,
  'surname-only matching is never accepted',
);

const siteCandidate = {
  id: 'site-1',
  addressLine1: '105 Ralston Ave.',
  addressLine2: null,
  townCity: 'Glasgow',
  postcode: 'G52 3QH',
};
assert.equal(
  scoreSiteMatch(siteCandidate, {
    addressLine1: '105 Ralston Avenue',
    townCity: 'GLASGOW',
    postcode: 'G52 3QH',
  })?.strength,
  'strong',
  'minor street suffix formatting differences do not create duplicate sites',
);

assert.equal(
  scoreProjectMatch({
    id: 'project-1',
    name: 'Ralston Avenue Extension',
    internalReference: '24-101',
    projectType: 'domestic_alteration_extension',
    siteId: 'site-1',
    siteAddress: '105 Ralston Avenue, Glasgow',
    site: siteCandidate,
  }, {
    client: {},
    site: {
      addressLine1: '105 Ralston Avenue',
      townCity: 'Glasgow',
      postcode: 'G52 3QH',
    },
    project: {
      name: 'Ralston Avenue Extension',
      internalReference: '24_101',
      typeOfWorkKey: 'domestic_alteration_extension',
    },
  })?.strength,
  'strong',
  'project references are normalised before suggesting an existing project',
);

const createRoute = fs.readFileSync('src/pages/api/application-drafts/index.ts', 'utf8');
const draftRoute = fs.readFileSync('src/pages/api/application-drafts/[id]/index.ts', 'utf8');
const analyseRoute = fs.readFileSync('src/pages/api/application-drafts/[id]/analyse.ts', 'utf8');
const commitRoute = fs.readFileSync('src/pages/api/application-drafts/[id]/commit.ts', 'utf8');
const addDocumentsRoute = fs.readFileSync('src/pages/api/application-drafts/[id]/documents/index.ts', 'utf8');
const documentRoute = fs.readFileSync('src/pages/api/application-drafts/[id]/documents/[documentId].ts', 'utf8');
const viewService = fs.readFileSync('src/server/services/application-draft-view.service.ts', 'utf8');
const matchingService = fs.readFileSync('src/server/services/application-draft-matching.service.ts', 'utf8');
const commitService = fs.readFileSync('src/server/services/application-draft-commit.service.ts', 'utf8');
const reviewUi = fs.readFileSync('src/components/applications/ApplicationDraftReview.tsx', 'utf8');

for (const route of [createRoute, draftRoute, analyseRoute, commitRoute, addDocumentsRoute, documentRoute]) {
  assert.match(route, /requireOrganisation\(context\)/, 'every draft route derives its organisation from the session');
}
for (const route of [createRoute, draftRoute, analyseRoute, commitRoute, addDocumentsRoute, documentRoute]) {
  if (!/export const (?:POST|PATCH|DELETE)/.test(route)) continue;
  assert.match(route, /assertAllowedOrigin\(context\.request\)/, 'every draft mutation checks its origin');
  assert.match(route, /assertRateLimit\(context,/, 'every draft mutation is rate limited');
}
assert.match(
  documentRoute,
  /draft:\s*\{\s*organisationId:\s*organisation\.id\s*\}/s,
  'draft previews are scoped through the owning organisation',
);
assert.doesNotMatch(viewService, /storageKey:\s*document\./, 'browser draft DTOs never expose raw storage keys');
assert.match(
  matchingService,
  /where:\s*\{\s*organisationId\s*\}/g,
  'all existing-record match candidates are organisation scoped',
);
assert.match(
  commitService,
  /where:\s*\{\s*id:\s*review\.existingClientId,\s*organisationId\s*\}/s,
  'foreign client ids are revalidated against the active organisation',
);
assert.match(
  commitService,
  /status === ApplicationDraftStatus\.COMMITTED[\s\S]+created:\s*false/,
  'repeated commits return the stored results rather than creating duplicates',
);
assert.match(commitService, /status:\s*ApplicationDraftStatus\.COMMITTING/, 'commit claims the draft before record creation');
assert.match(commitService, /AutomationJobStatus\.READY/, 'a completed human review creates a launch-ready job');
assert.doesNotMatch(reviewUi, /confidence\s*%|Math\.round\([^)]*confidence/i, 'review UI hides confidence percentages');
assert.doesNotMatch(reviewUi, /storageKey|raw JSON|prompt output/i, 'review UI does not expose storage or model internals');

console.log('application draft tests passed');

// Building Warrant answers in the New application review: usual answers pre-selected, follow-ups carried through.
{
  const { buildingWarrantDraftAnswers, WARRANT_TICK_DEFAULTS } = await import('../src/lib/building-warrant-draft-answers');
  const { BUILDING_WARRANT_CONFIRMATION_DEFAULTS } = await import('../src/lib/validation/domain');
  for (const [key, value] of Object.entries(BUILDING_WARRANT_CONFIRMATION_DEFAULTS)) {
    if (key in WARRANT_TICK_DEFAULTS) assert.equal(WARRANT_TICK_DEFAULTS[key as keyof typeof WARRANT_TICK_DEFAULTS], value, `review default for ${key} matches the warrant page`);
  }
  const residential = { buildingUse: 'residential', typeOfWorkKeys: ['domestic_alteration_extension'] };
  const untouched = buildingWarrantDraftAnswers({}, residential);
  assert.equal(untouched.applicantIsOwner, true);
  assert.equal(untouched.fireAndRescueServiceEnforcingAuthority, true);
  for (const key of ['listedBuildingOrConservationArea', 'otherHistoricalImportance', 'scottishMinistersRelaxationDirection', 'dangerousBuildingNotice', 'coveredBySTAS', 'approvedCertifierOfConstruction', 'disabledPersonsFacilitiesOnly', 'workStartedBeforeApplication', 'applicationIsStaged', 'intendedLifeFiveYearsOrLess', 'restrictPublicInspection'] as const) {
    assert.equal(untouched[key], false, `${key} starts as No`);
  }
  const fixedStayNo = buildingWarrantDraftAnswers({ applicationIsStaged: true, restrictPublicInspection: true, intendedLifeFiveYearsOrLess: true, workStartedBeforeApplication: true }, residential);
  assert.equal(fixedStayNo.applicationIsStaged || fixedStayNo.restrictPublicInspection || fixedStayNo.intendedLifeFiveYearsOrLess || fixedStayNo.workStartedBeforeApplication, false, 'answers with no Yes script stay No');
  assert.equal(buildingWarrantDraftAnswers({ coveredBySTAS: true, stasReference: 'ST-1' }, residential).coveredBySTAS, false, 'STAS stays No when screening does not allow it');
  const answered = buildingWarrantDraftAnswers({
    applicantIsOwner: false, ownerIsClient: false, ownerTitle: 'Mr', ownerFirstName: 'Iain', ownerLastName: 'Reid',
    fireAndRescueServiceEnforcingAuthority: false, fireAuthorityName: 'Tayside Fire',
    listedBuildingOrConservationArea: true, listingCategory: 'Category B',
    scottishMinistersRelaxationDirection: true, relaxationReference: 'RD-1', relaxationDate: '2026-11-01',
    coveredBySTAS: true, stasReference: 'ST-9',
    approvedCertifierOfConstruction: true, constructionSchemeType: '1', constructionCertifierName: 'A Certifier', certifierOfConstructionCertificateAvailable: true,
    certifierOfDesignCertificateAvailable: true, designCertificateTiming: 'following_application',
  }, { buildingUse: 'commercial', typeOfWorkKeys: ['new_build'] });
  assert.equal(answered.fireAuthorityName, 'Tayside Fire');
  assert.equal(answered.listingCategory, 'Category B');
  assert.deepEqual(answered.relaxationDirections, [{ reference: 'RD-1', date: '2026-11-01' }]);
  assert.equal(answered.stasReference, 'ST-9');
  assert.equal(answered.ownerIsClient, false);
  assert.deepEqual(answered.ownerDetails, { title: 'Mr', firstName: 'Iain', lastName: 'Reid', country: 'United Kingdom' });
  assert.equal(answered.constructionCertificate?.schemeType, '1');
  assert.equal(answered.certifierOfConstructionCertificateAvailable, true);
  assert.equal(answered.designCertificateFollowingApplication, true);
  assert.equal(buildingWarrantDraftAnswers({ listingCategory: 'Stale text' }, residential).listingCategory, null, 'follow-up text is dropped when its question is No');
  console.log('Building Warrant review answers: defaults, fixed answers and follow-ups passed.');
}
