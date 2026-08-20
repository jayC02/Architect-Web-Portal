import assert from 'node:assert/strict';
import {
  AutomationJobType,
  DocumentSortSource,
  DocumentStatus,
  DocumentType,
  PlanningStatus,
  ProjectStage,
  ProjectStatus,
  WarrantStatus,
} from '@prisma/client';
import { prisma } from '../src/lib/db/prisma';
import { buildFreshAutomationJob } from '../src/server/services/automation-jobs.service';

const organisationId = 'org-current-data';
const projectId = 'project-current-data';
const planningId = 'planning-current-data';
const warrantId = 'warrant-current-data';
const createdBy = { id: 'user-current-data', name: 'Current Architect', email: 'architect@example.com' };

let version = 1;
let mode: 'planning' | 'warrant' = 'planning';
let clientName = 'Old Applicant';
let clientPostcode = 'G23 OLD';
let sitePostcode = 'G23 OLD';
let agentFirstName = 'Old Agent';
let planningConfirmation = false;
let warrantConfirmation = false;
let typeOfWorkKeys = ['domestic_alteration_extension'];
let documentId = 'document-a';

const changedAt = () => new Date(`2026-08-${String(version).padStart(2, '0')}T10:00:00.000Z`);
const projectRecord = () => ({
  id: projectId,
  organisationId,
  name: 'Current data project',
  internalReference: 'AP-CURRENT',
  projectType: typeOfWorkKeys[0],
  notes: null,
  stage: mode === 'warrant' ? ProjectStage.BUILDING_WARRANT : ProjectStage.PLANNING,
  status: ProjectStatus.ACTIVE,
  siteAddress: '120 Blackhill Road',
  localAuthority: 'Glasgow City Council',
  updatedAt: changedAt(),
  client: {
    id: 'client-current-data',
    name: clientName,
    title: 'Mr',
    firstName: clientName.split(' ')[0],
    lastName: clientName.split(' ').slice(1).join(' '),
    companyName: null,
    email: 'applicant@example.com',
    phone: '01410000000',
    buildingNumber: '10',
    addressLine1: 'Client Street',
    addressLine2: null,
    address: '10 Client Street',
    townCity: 'Glasgow',
    postcode: clientPostcode,
    country: 'United Kingdom',
    updatedAt: changedAt(),
  },
  site: {
    id: 'site-current-data',
    buildingNumber: '120',
    addressLine1: 'Blackhill Road',
    addressLine2: null,
    townCity: 'Glasgow',
    postcode: sitePostcode,
    localAuthority: 'Glasgow City Council',
    updatedAt: changedAt(),
  },
});

const defaultsRecord = () => ({
  organisationId,
  practiceName: 'Current Architecture Practice',
  agentFirstName,
  agentLastName: 'Architect',
  agentEmail: 'agent@example.com',
  agentPhone: '01411111111',
  agentBuildingNumber: '20',
  agentAddressLine1: 'Practice Street',
  agentAddressLine2: null,
  agentTownCity: 'Glasgow',
  agentPostcode: 'G1 1AA',
  agentCountry: 'United Kingdom',
  updatedAt: changedAt(),
  defaultCertifierPreset: null,
});

const planningRecord = () => ({
  id: planningId,
  description: 'Householder works',
  notes: null,
  status: PlanningStatus.DRAFTING,
  applicationReference: 'PORTAL-PLANNING-1',
  preparationData: {
    discussedWithPlanningAuthority: planningConfirmation,
    treesOnOrAdjacentToSite: false,
    newOrAlteredVehicleAccess: false,
    soleOwner: true,
    agriculturalHolding: false,
  },
  updatedAt: changedAt(),
});

const warrantRecord = () => ({
  id: warrantId,
  description: 'Building warrant works',
  notes: null,
  presetKey: typeOfWorkKeys[0],
  presetVersion: 1,
  estimatedValue: 30_000,
  currentUse: 'Dwelling',
  proposedUse: 'Dwelling',
  status: WarrantStatus.DRAFTING,
  warrantReference: 'PORTAL-WARRANT-1',
  preparationData: {
    typeOfWorkKeys,
    dangerousBuildingNotice: warrantConfirmation,
  },
  selectedCertifierPreset: null,
  updatedAt: changedAt(),
});

const documentRecords = () => [{
  id: documentId,
  originalName: `${documentId}.pdf`,
  fileName: `${documentId}.pdf`,
  mimeType: 'application/pdf',
  sizeBytes: 1_024,
  type: DocumentType.LOCATION_PLAN,
  drawingTitle: 'Location plan',
  drawingNumber: documentId,
  revision: version === 1 ? 'A' : 'B',
  sortSource: DocumentSortSource.MANUAL,
  sortConfidence: 1,
  status: DocumentStatus.APPROVED,
  createdAt: changedAt(),
  updatedAt: changedAt(),
}];

const delegates = {
  projectFindFirst: prisma.project.findFirst,
  defaultsFindUnique: prisma.organisationDefaults.findUnique,
  planningFindFirst: prisma.planningApplication.findFirst,
  warrantFindFirst: prisma.buildingWarrantApplication.findFirst,
  documentsFindMany: prisma.projectDocument.findMany,
};

try {
  (prisma.project as any).findFirst = async () => projectRecord();
  (prisma.organisationDefaults as any).findUnique = async () => defaultsRecord();
  (prisma.planningApplication as any).findFirst = async () => mode === 'planning' ? planningRecord() : null;
  (prisma.buildingWarrantApplication as any).findFirst = async () => mode === 'warrant' ? warrantRecord() : null;
  (prisma.projectDocument as any).findMany = async () => documentRecords();

  const oldPlanningJob = await buildFreshAutomationJob({
    organisationId,
    organisationName: 'Current Organisation',
    projectId,
    type: AutomationJobType.HOUSEHOLDER_PLANNING,
    createdBy,
    planningApplicationId: planningId,
  });

  version = 2;
  clientName = 'New Applicant';
  clientPostcode = 'G2 2BB';
  sitePostcode = 'G23 5HD';
  agentFirstName = 'New Agent';
  planningConfirmation = true;
  documentId = 'document-b';

  const newPlanningJob = await buildFreshAutomationJob({
    organisationId,
    organisationName: 'Current Organisation',
    projectId,
    type: AutomationJobType.HOUSEHOLDER_PLANNING,
    createdBy,
    planningApplicationId: planningId,
  });

  assert.notEqual(newPlanningJob.jobId, oldPlanningJob.jobId, 'retry gets a new AutomationJob identity');
  assert.notEqual(newPlanningJob.snapshot.snapshotHash, oldPlanningJob.snapshot.snapshotHash, 'current data produces a new immutable snapshot');
  assert.equal(oldPlanningJob.snapshot.dataSnapshot.site.address.postcode, 'G23 OLD', 'Job A keeps its original Site postcode');
  assert.equal(oldPlanningJob.snapshot.dataSnapshot.applicant.displayName, 'Old Applicant', 'Job A keeps its original applicant');
  assert.equal(oldPlanningJob.snapshot.dataSnapshot.planning?.answers.discussedWithPlanningAuthority, false, 'Job A keeps its original confirmation');
  assert.deepEqual(oldPlanningJob.snapshot.dataSnapshot.documents.map((document) => document.id), ['document-a'], 'Job A keeps document set A');
  assert.equal(newPlanningJob.snapshot.dataSnapshot.site.address.postcode, 'G23 5HD', 'Job B reads the current Site postcode');
  assert.equal(newPlanningJob.snapshot.dataSnapshot.applicant.displayName, 'New Applicant', 'Job B reads the current Client/applicant');
  assert.equal(newPlanningJob.snapshot.dataSnapshot.applicant.address.postcode, 'G2 2BB', 'Job B reads the current applicant address');
  assert.equal(newPlanningJob.snapshot.dataSnapshot.organisation.agent.firstName, 'New Agent', 'Job B reads current Agent defaults');
  assert.equal(newPlanningJob.snapshot.dataSnapshot.planning?.answers.discussedWithPlanningAuthority, true, 'Job B reads current Planning confirmations');
  assert.deepEqual(newPlanningJob.snapshot.dataSnapshot.documents.map((document) => document.id), ['document-b'], 'Job B reads the current document mapping');
  assert.equal(newPlanningJob.snapshot.dataSnapshot.planning?.recordId, planningId, 'safe Planning portal identity is preserved separately');

  mode = 'warrant';
  version = 3;
  typeOfWorkKeys = ['domestic_alteration_extension'];
  warrantConfirmation = false;
  const oldWarrantJob = await buildFreshAutomationJob({
    organisationId,
    organisationName: 'Current Organisation',
    projectId,
    type: AutomationJobType.BUILDING_WARRANT,
    createdBy,
    buildingWarrantApplicationId: warrantId,
  });

  version = 4;
  typeOfWorkKeys = ['new_build'];
  warrantConfirmation = true;
  const newWarrantJob = await buildFreshAutomationJob({
    organisationId,
    organisationName: 'Current Organisation',
    projectId,
    type: AutomationJobType.BUILDING_WARRANT,
    createdBy,
    buildingWarrantApplicationId: warrantId,
  });

  assert.notEqual(newWarrantJob.jobId, oldWarrantJob.jobId, 'Building Warrant retry also gets a new identity');
  assert.deepEqual(oldWarrantJob.snapshot.dataSnapshot.buildingWarrant?.typeOfWorkKeys, ['domestic_alteration_extension']);
  assert.equal(oldWarrantJob.snapshot.dataSnapshot.buildingWarrant?.unusualAnswers.dangerousBuildingNotice, false);
  assert.deepEqual(newWarrantJob.snapshot.dataSnapshot.buildingWarrant?.typeOfWorkKeys, ['new_build'], 'Job B reads current Type of Work');
  assert.equal(newWarrantJob.snapshot.dataSnapshot.buildingWarrant?.unusualAnswers.dangerousBuildingNotice, true, 'Job B reads current Warrant confirmations');
  assert.equal(newWarrantJob.snapshot.dataSnapshot.buildingWarrant?.recordId, warrantId, 'safe Warrant portal identity is preserved separately');
} finally {
  (prisma.project as any).findFirst = delegates.projectFindFirst;
  (prisma.organisationDefaults as any).findUnique = delegates.defaultsFindUnique;
  (prisma.planningApplication as any).findFirst = delegates.planningFindFirst;
  (prisma.buildingWarrantApplication as any).findFirst = delegates.warrantFindFirst;
  (prisma.projectDocument as any).findMany = delegates.documentsFindMany;
  await prisma.$disconnect();
}

console.log('retry fresh snapshot tests passed');
