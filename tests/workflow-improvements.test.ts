import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ApplicationDraftType, DocumentStatus, DocumentType } from '@prisma/client';
import { evaluateClientApplicationDraftReadiness } from '../src/lib/application-draft-readiness';
import { applicationDraftReviewSchema } from '../src/lib/validation/application-draft';
import { automationJobSnapshotV2Schema } from '../src/lib/validation/automation-job';
import { certifierProfileKey } from '../src/server/services/certifier-presets.service';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const projectPage = source('src/pages/projects/[id].astro');
const newProjectPage = source('src/pages/projects/new.astro');
const projectsApi = source('src/pages/api/projects/index.ts');
const directories = source('src/components/live/LiveDataPanel.tsx');
const certifierRoute = source('src/pages/api/building-warrant/[id]/certifier-details.ts');
const certifierPage = source('src/pages/building-warrant/[id]/preparation.astro');
const snapshotService = source('src/server/services/automation-jobs.service.ts');

assert.match(projectPage, /`\/clients\?edit=\$\{project\.client\.id\}`/, 'Client opens its existing editable record');
assert.match(projectPage, /`\/sites\?edit=\$\{project\.site\.id\}`/, 'Site opens its existing editable record');
assert.match(directories, /new URLSearchParams\(window\.location\.search\)\.get\('edit'\)/, 'directory drawers accept record edit links');
assert.ok(
  projectPage.indexOf('href="#project-details"') < projectPage.indexOf('id="overview"'),
  'Edit project details is immediately available above the project overview',
);

assert.match(newProjectPage, /data-project-name=\{projectName\}/, 'site choices carry the complete formatted address');
assert.match(newProjectPage, /record\.addressLine1, record\.addressLine2, record\.townCity, record\.postcode/, 'newly entered sites use every available address component');
assert.match(projectsApi, /body\.name\?\.trim\(\) \|\| links\.derivedSite\?\.siteAddress/, 'the server defaults a new project name to the organisation-scoped linked site address');

const certifier = {
  schemeType: 'Approved Scheme',
  registrationAPart1: 'BRE1',
  registrationAPart2: '1234',
  certifierName: 'Casey Certifier',
  registrationBPart1: 'SER1',
  registrationBPart2: '5678',
  approvedBody: 'Approved Body',
};
assert.equal(
  certifierProfileKey(certifier),
  certifierProfileKey({ ...certifier, certifierName: '  CASEY   CERTIFIER ' }),
  'identical certifier details share one canonical profile key',
);
assert.notEqual(
  certifierProfileKey(certifier),
  certifierProfileKey({ ...certifier, registrationBPart2: '9999' }),
  'materially different certifier details remain separate profiles',
);
assert.match(certifierRoute, /findOrCreateCertifierProfile\(prisma, organisation\.id/, 'saving valid application details creates or reuses a certifier profile');
assert.match(certifierRoute, /selectedCertifierPresetId: preset\.id/, 'the reusable profile remains associated with the Building Warrant application');
for (const field of ['schemeType', 'registrationAPart1', 'registrationAPart2', 'certifierName', 'registrationBPart1', 'registrationBPart2', 'approvedBody']) {
  assert.match(certifierPage, new RegExp(`data-${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`), `saved profiles expose ${field} to the existing selector`);
}
assert.match(certifierPage, /field\.value = value/, 'selecting a profile repopulates its certificate fields');

const legacyReview = applicationDraftReviewSchema.parse({
  selectedApplicationType: ApplicationDraftType.BUILDING_WARRANT,
  projectMode: 'create', existingProjectId: null,
  project: { name: '14 Test Street, Glasgow, G1 1AA', internalReference: null, typeOfWorkKey: 'new_build', summary: null },
  siteMode: 'create', existingSiteId: null,
  site: { addressLine1: '14 Test Street', addressLine2: null, townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom', localAuthority: 'Glasgow City Council' },
  clientMode: 'create', existingClientId: null,
  client: { clientType: 'INDIVIDUAL', displayName: 'Ms Test Client', title: 'Ms', firstName: 'Test', lastName: 'Client', companyName: null, email: 'client@example.com', phone: null, addressLine1: '14 Test Street', addressLine2: null, townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom' },
  clientAddressSameAsSite: true,
  applicantDifferentFromClient: false,
  applicant: { clientType: 'INDIVIDUAL', displayName: 'Ms Test Client', title: 'Ms', firstName: 'Test', lastName: 'Client', companyName: null, email: 'client@example.com', phone: null, addressLine1: '14 Test Street', addressLine2: null, townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom' },
  agent: { practiceName: 'Example Architects', firstName: 'Alex', lastName: 'Agent', email: 'agent@example.com', phone: null, addressLine1: '20 Practice Road', addressLine2: null, townCity: 'Glasgow', postcode: 'G2 2BB', country: 'United Kingdom', saveAsOrganisationDefault: false },
  application: { description: 'Construct a new residential dwelling.', currentUse: 'Vacant', proposedUse: 'Dwelling', estimatedValue: 200000, presetKey: 'new_build', typeOfWorkKeys: ['new_build'], selectedCertifierPresetId: null },
  confirmations: { applicantIsOwner: true, applicationIsStaged: false, intendedLifeFiveYearsOrLess: false, fireAndRescueServiceEnforcingAuthority: true, listedBuildingOrConservationArea: false, otherHistoricalImportance: false, scottishMinistersRelaxationDirection: false, dangerousBuildingNotice: false, approvedCertifierOfConstruction: false, coveredBySTAS: false, restrictPublicInspection: false },
  documents: [{ id: 'location', documentType: DocumentType.LOCATION_PLAN, documentStatus: DocumentStatus.APPROVED, revision: null, drawingNumber: null, drawingTitle: null }],
});
assert.equal(legacyReview.agent.buildingNumber, null, 'older application data remains loadable without a building number');
assert.ok(evaluateClientApplicationDraftReadiness(legacyReview).some((issue) => issue.key === 'agent.buildingNumber'), 'a missing Agent building number blocks readiness with a field-specific issue');
assert.ok(!evaluateClientApplicationDraftReadiness({ ...legacyReview, agent: { ...legacyReview.agent, buildingNumber: '20' } }).some((issue) => issue.key === 'agent.buildingNumber'), 'supplying the Agent building number clears its readiness issue');

const legacySnapshot = JSON.parse(source('tests/fixtures/automation-job-v2-building-warrant.json'));
const parsedLegacySnapshot = automationJobSnapshotV2Schema.parse(legacySnapshot);
assert.equal(parsedLegacySnapshot.organisation.agent.buildingNumber, null, 'older desktop snapshots remain loadable');
assert.match(snapshotService, /buildingNumber: defaults\?\.agentBuildingNumber \?\? null/, 'new snapshots include the saved Agent building number');

console.log('workflow improvement tests passed');
