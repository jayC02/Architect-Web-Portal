import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { CompletionCertificateStatus, PlanningStatus, WarrantStatus, WarrantType } from '@prisma/client';
import { automationJobSnapshotV2Schema } from '../src/lib/validation/automation-job';
import {
  buildingWarrantCertifierDetailsSchema,
  clientSchema,
  planningPreparationDetailsSchema,
} from '../src/lib/validation/domain';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const client = clientSchema.parse({ name: 'Test Client', buildingNumber: '147' });
assert.equal(client.buildingNumber, '147', 'client editing accepts and preserves Building Number');
assert.match(source('src/components/live/LiveDataPanel.tsx'), /name="buildingNumber"[\s\S]*client\?\.buildingNumber/, 'the existing client form loads and saves Building Number');
assert.match(source('src/pages/api/clients/index.ts'), /companyName: true,\s+buildingNumber: true,/, 'the Clients API returns the saved Building Number when reopening the editor');
assert.ok(existsSync(new URL('../prisma/migrations/20260807120000_client_building_number/migration.sql', import.meta.url)), 'the intended nullable Client field has a migration');

const fixture = JSON.parse(source('tests/fixtures/automation-job-v2-building-warrant.json'));
fixture.organisation.agent.buildingNumber = '20';
fixture.applicant.buildingNumber = '147';
const snapshot = automationJobSnapshotV2Schema.parse(fixture);
assert.equal(snapshot.organisation.agent.buildingNumber, '20', 'Agent Building Number survives the snapshot contract');
assert.equal(snapshot.applicant.buildingNumber, '147', 'Applicant Building Number survives the snapshot contract');

const snapshotService = source('src/server/services/automation-jobs.service.ts');
assert.match(snapshotService, /buildingNumber: project\.client\.buildingNumber/, 'client Building Number is written into new automation snapshots');
assert.match(snapshotService, /buildingNumber: nullableString\(person\.buildingNumber\)/, 'separate applicant overrides retain Building Number');
const commitService = source('src/server/services/application-draft-commit.service.ts');
assert.match(commitService, /buildingNumber: review\.client\.buildingNumber/, 'draft commit persists the applicant Building Number on the Client');
assert.match(commitService, /buildingNumber: person\.buildingNumber/, 'draft snapshot overrides include the applicant Building Number');

const planningManage = source('src/pages/planning/[id]/preparation.astro');
const warrantManage = source('src/pages/building-warrant/[id]/preparation.astro');
const planningCreate = source('src/pages/projects/[id].astro');
const warrantCreate = source('src/pages/projects/[id].astro');
for (const field of ['applicationReference', 'submissionDate', 'validDate', 'decisionTargetDate', 'decisionDate', 'status', 'portalUrl', 'notes']) {
  assert.match(planningManage, new RegExp(`name="${field}"`), `Planning Manage exposes ${field}`);
}
for (const field of ['warrantReference', 'warrantType', 'submissionDate', 'firstResponseTargetDate', 'grantedDate', 'expiryDate', 'completionCertificateStatus', 'status', 'portalUrl', 'notes']) {
  assert.match(warrantManage, new RegExp(`name="${field}"`), `Building Warrant Manage exposes ${field}`);
}
assert.doesNotMatch(planningCreate, /name="applicationReference"/, 'the initial Planning creation form remains simple');
assert.doesNotMatch(warrantCreate, /name="warrantReference"/, 'the initial Building Warrant creation form remains simple');

const planningDetails = planningPreparationDetailsSchema.parse({
  jobId: '', applicationReference: 'PP-100', submissionDate: '2026-08-01', validDate: '', decisionTargetDate: '', decisionDate: '',
  status: PlanningStatus.SUBMITTED, portalUrl: 'https://example.com/planning/PP-100', notes: 'Tracked note',
  description: 'Single-storey rear extension', discussedWithPlanningAuthority: 'false', treesOnOrAdjacentToSite: 'false',
  newOrAlteredVehicleAccess: 'false', currentParkingSpaces: '', proposedParkingSpaces: '', soleOwner: 'true', agriculturalHolding: 'false',
});
assert.equal(planningDetails.applicationReference, 'PP-100');
assert.equal(planningDetails.status, PlanningStatus.SUBMITTED);

const warrantDetails = buildingWarrantCertifierDetailsSchema.parse({
  jobId: '', warrantReference: 'BW-100', warrantType: WarrantType.INITIAL, submissionDate: '', firstResponseTargetDate: '', grantedDate: '', expiryDate: '',
  completionCertificateStatus: CompletionCertificateStatus.NOT_REQUIRED, status: WarrantStatus.DRAFTING, portalUrl: '', notes: 'Tracked note',
  typeOfWorkKeys: ['new_build'], description: 'Construct a new residential dwelling', estimatedValue: '200000', currentUse: 'Vacant', proposedUse: 'Dwelling',
  selectedCertifierPresetId: '', schemeType: 'SER', registrationAPart1: 'SER1', registrationAPart2: '123', certifierName: 'Test Certifier',
  registrationBPart1: 'SER1', registrationBPart2: '456', approvedBody: 'Test Approved Body',
});
assert.equal(warrantDetails.warrantReference, 'BW-100');
assert.equal(warrantDetails.status, WarrantStatus.DRAFTING);

const planningHandler = source('src/pages/api/planning/[id]/complete-details.ts');
const warrantHandler = source('src/pages/api/building-warrant/[id]/certifier-details.ts');
assert.match(planningHandler, /applicationReference,[\s\S]*status: applicationStatus/, 'Planning Manage saves full record values through its organisation-scoped handler');
assert.match(warrantHandler, /warrantReference: body\.warrantReference[\s\S]*status: body\.status/, 'Building Warrant Manage saves full record values through its organisation-scoped handler');
assert.match(planningHandler, /buildAutomationJobSnapshot/, 'Planning edits refresh an existing desktop handoff');
assert.match(warrantHandler, /buildAutomationJobSnapshot/, 'Building Warrant edits refresh an existing desktop handoff');

console.log('contained application management tests passed');
