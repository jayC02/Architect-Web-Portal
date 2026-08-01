import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AutomationJobSourceType,
  AutomationJobStatus,
  AutomationJobType,
  DocumentStatus,
  DocumentType,
} from '@prisma/client';
import {
  buildingWarrantProfileForTypeOfWork,
  TYPE_OF_WORK_OPTIONS,
} from '../src/lib/projects/type-of-work';
import {
  assertSafeAutomationSnapshot,
  automationJobDocumentSnapshotSchema,
  automationJobSnapshotSchema,
  automationJobSnapshotV2Schema,
} from '../src/lib/validation/automation-job';
import {
  buildingWarrantCertifierDetailsSchema,
  buildingWarrantPreparationUpdateSchema,
  certifierPresetSchema,
  householderPreparationUpdateSchema,
} from '../src/lib/validation/domain';
import { CERTIFIER_REGISTRATION_PART1_CODES } from '../src/lib/certifier-registration';
import { assertAutomationJobTransition } from '../src/server/services/automation-lifecycle.service';

const document = {
  id: 'doc_1',
  originalName: 'Location Plan.pdf',
  fileName: 'location-plan.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 12000,
  type: DocumentType.LOCATION_PLAN,
  status: DocumentStatus.APPROVED,
  revision: 'P01',
  drawingNumber: 'A001',
  drawingTitle: 'Location Plan',
  uploadedAt: new Date('2026-06-05T10:00:00.000Z').toISOString(),
};

const documentSnapshot = automationJobDocumentSnapshotSchema.parse({
  schemaVersion: 1,
  documents: [document],
});

const dataSnapshot = automationJobSnapshotSchema.parse({
  schemaVersion: 1,
  jobType: AutomationJobType.BUILDING_WARRANT,
  sourceType: AutomationJobSourceType.PROJECT,
  organisation: { id: 'org_1', name: 'NinetyOneArchitects' },
  project: {
    id: 'project_1',
    name: '4 Willow Court',
    internalReference: '3567',
    projectType: 'Domestic alteration',
    stage: 'BUILDING_WARRANT',
    status: 'ACTIVE',
    localAuthority: 'Glasgow',
    siteAddress: '4 Willow Court, Glasgow',
    notes: null,
    createdAt: new Date('2026-06-01T10:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-06-05T10:00:00.000Z').toISOString(),
  },
  client: {
    id: 'client_1',
    name: 'Test Client',
    email: 'client@example.com',
    phone: null,
    address: null,
    notes: null,
  },
  site: null,
  planningApplication: null,
  buildingWarrantApplication: null,
  applicationQuestions: {},
  documents: documentSnapshot.documents,
  notes: null,
  createdAt: new Date('2026-06-05T10:00:00.000Z').toISOString(),
});

assert.equal(dataSnapshot.schemaVersion, 1);
assert.equal(dataSnapshot.documents[0].type, DocumentType.LOCATION_PLAN);
assert.doesNotThrow(() => assertSafeAutomationSnapshot(dataSnapshot));
assert.doesNotThrow(() => assertSafeAutomationSnapshot(documentSnapshot));
assert.throws(() => assertSafeAutomationSnapshot({ project: { storageKey: 'private/path.pdf' } }), /Unsafe automation snapshot field/);
assert.throws(() => assertSafeAutomationSnapshot({ credentials: { password: 'secret' } }), /Unsafe automation snapshot field/);

assert.deepEqual(TYPE_OF_WORK_OPTIONS, [
  'Domestic alteration / extension',
  'New build',
  'Conversion / change of use',
  'Demolition',
], 'project creation exposes only the four supported Building Warrant profiles');

for (const [typeOfWork, expectedProfile] of [
  ['Domestic alteration / extension', 'Domestic alteration / extension'],
  ['New build', 'New build'],
  ['Conversion / change of use', 'Conversion / change of use'],
  ['Demolition', 'Demolition'],
] as const) {
  assert.equal(
    buildingWarrantProfileForTypeOfWork(typeOfWork),
    expectedProfile,
    `${typeOfWork} maps to the matching Building Warrant profile`,
  );
}
assert.equal(buildingWarrantProfileForTypeOfWork('Extension'), 'Domestic alteration / extension', 'legacy project types retain a safe profile fallback');

assert.doesNotThrow(() => assertAutomationJobTransition(
  AutomationJobStatus.PREFLIGHT_REQUIRED,
  AutomationJobStatus.READY,
));
assert.doesNotThrow(() => assertAutomationJobTransition(
  AutomationJobStatus.IN_PROGRESS,
  AutomationJobStatus.AWAITING_PORTAL_REVIEW,
));
assert.throws(
  () => assertAutomationJobTransition(
    AutomationJobStatus.IN_PROGRESS,
    AutomationJobStatus.COMPLETED,
  ),
  /cannot move/,
  'desktop completion must stop at portal review rather than implying submission',
);
assert.throws(
  () => assertAutomationJobTransition(
    AutomationJobStatus.COMPLETED,
    AutomationJobStatus.IN_PROGRESS,
  ),
  /cannot move/,
  'terminal jobs cannot return to active execution',
);
assert.doesNotThrow(() => assertAutomationJobTransition(
  AutomationJobStatus.AWAITING_PORTAL_REVIEW,
  AutomationJobStatus.COMPLETED,
));

const householderPreparation = householderPreparationUpdateSchema.parse({
  description: 'Single-storey rear extension',
  discussedWithPlanningAuthority: 'false',
  treesOnOrAdjacentToSite: 'false',
  newOrAlteredVehicleAccess: 'true',
  currentParkingSpaces: '1',
  proposedParkingSpaces: '2',
  soleOwner: 'true',
  agriculturalHolding: 'false',
});
assert.equal(householderPreparation.soleOwner, true);
assert.equal(householderPreparation.currentParkingSpaces, 1);
assert.throws(() => householderPreparationUpdateSchema.parse({
  ...householderPreparation,
  newOrAlteredVehicleAccess: true,
  currentParkingSpaces: '',
}), /current parking spaces/i);

const warrantPreparation = buildingWarrantPreparationUpdateSchema.parse({
  description: 'Internal alterations and rear extension',
  estimatedValue: '35000',
  currentUse: 'Dwelling',
  proposedUse: 'Dwelling',
  presetKey: 'domestic_alteration_extension',
  selectedCertifierPresetId: '',
  applicantIsOwner: 'true',
  applicationIsStaged: 'false',
  intendedLifeFiveYearsOrLess: 'false',
  fireAndRescueServiceEnforcingAuthority: 'true',
  listedBuildingOrConservationArea: 'false',
  otherHistoricalImportance: 'false',
  scottishMinistersRelaxationDirection: 'false',
  dangerousBuildingNotice: 'false',
  approvedCertifierOfConstruction: 'false',
  coveredBySTAS: 'false',
  restrictPublicInspection: 'false',
});
assert.equal(warrantPreparation.estimatedValue, 35000);
assert.equal(warrantPreparation.selectedCertifierPresetId, undefined);

assert.deepEqual(CERTIFIER_REGISTRATION_PART1_CODES, ['BRE1', 'BRE2', 'RIA1', 'RIA2', 'SER1']);
assert.doesNotThrow(() => buildingWarrantCertifierDetailsSchema.parse({
  jobId: 'job_1',
  registrationAPart1: 'BRE1',
  registrationBPart1: 'SER1',
}));
assert.throws(() => buildingWarrantCertifierDetailsSchema.parse({
  jobId: 'job_1',
  registrationAPart1: 'INVALID',
  registrationBPart1: 'SER1',
}), /Invalid enum value/);
assert.throws(() => certifierPresetSchema.parse({
  displayName: 'Incorrect profile',
  registrationAPart1: 'INVALID',
}), /Invalid enum value/);

const warrantConfirmationKeys = [
  'applicantIsOwner',
  'applicationIsStaged',
  'intendedLifeFiveYearsOrLess',
  'fireAndRescueServiceEnforcingAuthority',
  'listedBuildingOrConservationArea',
  'otherHistoricalImportance',
  'scottishMinistersRelaxationDirection',
  'dangerousBuildingNotice',
  'approvedCertifierOfConstruction',
  'coveredBySTAS',
  'restrictPublicInspection',
];
const preparationPageSource = readFileSync(
  new URL('../src/pages/automation-job/[id].astro', import.meta.url),
  'utf8',
);
assert.match(preparationPageSource, /name="clientName" value=\{suggestedClientName\}/);
const preparationRouteSource = readFileSync(
  new URL('../src/pages/api/automation-jobs/[id]/preparation.ts', import.meta.url),
  'utf8',
);
const certifierDetailsRouteSource = readFileSync(
  new URL('../src/pages/api/building-warrant/[id]/certifier-details.ts', import.meta.url),
  'utf8',
);
const certifierPreparationPageSource = readFileSync(
  new URL('../src/pages/building-warrant/[id]/preparation.astro', import.meta.url),
  'utf8',
);
for (const key of warrantConfirmationKeys) {
  assert.match(preparationPageSource, new RegExp(`name: '${key}'`));
  assert.match(preparationRouteSource, new RegExp(`${key}: value\\.${key}`));
}
assert.match(certifierDetailsRouteSource, /organisationId: organisation\.id/, 'certifier updates are organisation scoped');
assert.match(certifierDetailsRouteSource, /automationJobApplicationId\(job\) !== application\.id/, 'certifier updates verify the exact job and application pairing');
assert.match(certifierDetailsRouteSource, /\.\.\.preparationData,[\s\S]*certifier:/, 'certifier values merge into existing application preparation data');
assert.match(certifierDetailsRouteSource, /redirectTo: `\/projects\/\$\{application\.projectId\}`/, 'completion returns to the project');
assert.match(certifierPreparationPageSource, /Registration number A Part 1/, 'the focused page shows registration A');
assert.match(certifierPreparationPageSource, /Registration number B Part 1/, 'the focused page shows registration B');

const sharedV2Fixture = JSON.parse(readFileSync(
  new URL('./fixtures/automation-job-v2-building-warrant.json', import.meta.url),
  'utf8',
));
assert.doesNotThrow(() => automationJobSnapshotV2Schema.parse(sharedV2Fixture));
assert.doesNotThrow(() => assertSafeAutomationSnapshot(sharedV2Fixture));

console.log('automation job contract tests passed');
