import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ApplicationDraftType, DocumentStatus, DocumentType } from '@prisma/client';
import { evaluateClientApplicationDraftReadiness } from '../src/lib/application-draft-readiness';
import { applicationDraftReviewSchema } from '../src/lib/validation/application-draft';

const source = (path: string) => fs.readFileSync(path, 'utf8');
const reviewUi = source('src/components/applications/ApplicationDraftReview.tsx');
const commitService = source('src/server/services/application-draft-commit.service.ts');
const siteDirectory = source('src/components/live/LiveDataPanel.tsx');
const snapshotService = source('src/server/services/automation-jobs.service.ts');

const review = applicationDraftReviewSchema.parse({
  selectedApplicationType: ApplicationDraftType.HOUSEHOLDER_PLANNING,
  projectMode: 'create',
  existingProjectId: null,
  project: { name: '144 Blackhill Drive', internalReference: null, typeOfWorkKey: null, summary: null },
  siteMode: 'create',
  existingSiteId: null,
  site: {
    buildingNumber: '144',
    addressLine1: 'Blackhill Drive',
    addressLine2: null,
    townCity: 'Glasgow',
    postcode: 'G23 5NN',
    country: 'United Kingdom',
    localAuthority: 'Glasgow City Council',
  },
  clientMode: 'create',
  existingClientId: null,
  client: {
    clientType: 'INDIVIDUAL', displayName: 'L MacDonald', title: 'Other', firstName: 'L', lastName: 'MacDonald',
    companyName: null, email: 'client@example.com', phone: null, buildingNumber: '144', addressLine1: 'Blackhill Drive',
    addressLine2: null, townCity: 'Glasgow', postcode: 'G23 5NN', country: 'United Kingdom',
  },
  clientAddressSameAsSite: true,
  applicantDifferentFromClient: false,
  applicant: undefined,
  agent: {
    practiceName: 'Architect Pro', firstName: 'Agent', lastName: 'Example', email: 'agent@example.com', phone: null,
    buildingNumber: '1', addressLine1: 'Practice Street', addressLine2: null, townCity: 'Glasgow', postcode: 'G1 1AA',
    country: 'United Kingdom', saveAsOrganisationDefault: false,
  },
  application: {
    description: 'Householder alterations.', currentUse: null, proposedUse: null, estimatedValue: null,
    presetKey: null, typeOfWorkKeys: [], selectedCertifierPresetId: null,
  },
  confirmations: {
    discussedWithPlanningAuthority: false, treesOnOrAdjacentToSite: false, newOrAlteredVehicleAccess: false,
    soleOwner: true, agriculturalHolding: false,
  },
  documents: [{
    id: 'location-plan', documentType: DocumentType.LOCATION_PLAN, documentStatus: DocumentStatus.APPROVED,
    revision: null, drawingNumber: null, drawingTitle: null,
  }],
});

assert.ok(
  !evaluateClientApplicationDraftReadiness(review).some((issue) => issue.key === 'site.buildingNumber'),
  'the Site building number satisfies same-address readiness',
);
assert.ok(
  evaluateClientApplicationDraftReadiness({ ...review, site: { ...review.site, buildingNumber: null } })
    .some((issue) => issue.key === 'site.buildingNumber'),
  'the Site section identifies a missing building number',
);
assert.match(reviewUi, /withSiteAddress[\s\S]*buildingNumber: site\.buildingNumber/, 'same-as-site copies the Site number');
assert.match(reviewUi, /showAddress \? <section[\s\S]*Address details/, 'same-as-site hides duplicate Client address inputs');
assert.match(reviewUi, /label="Building number"[\s\S]*review\.site\.buildingNumber/, 'the Site review owns the input');
assert.match(commitService, /buildingNumber: review\.site\.buildingNumber/, 'the canonical Site stores the number');
assert.match(siteDirectory, /name="buildingNumber"[\s\S]*site\?\.buildingNumber/, 'Site profiles load and save the number');
assert.match(snapshotService, /displayName: \[project\.site\.buildingNumber, project\.site\.addressLine1\]/, 'desktop Site identity keeps the full numbered address');

console.log('site building-number flow tests passed');
