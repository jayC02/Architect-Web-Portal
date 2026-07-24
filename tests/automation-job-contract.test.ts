import assert from 'node:assert/strict';
import {
  AutomationJobSourceType,
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
} from '../src/lib/validation/automation-job';

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

console.log('automation job contract tests passed');
