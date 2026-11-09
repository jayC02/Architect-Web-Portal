import { missingOwnerDetails, ownerFromForm, resolveWarrantOwner } from '../src/lib/building-warrant-owner';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildingWarrantPreparationUpdateSchema, buildingWarrantPreparationSchema, planningPreparationDetailsSchema } from '../src/lib/validation/domain';
import { warrantSectionForRequirement } from '../src/lib/preparation-sections';
import { sustainabilityFromForm } from '../src/lib/building-warrant-follow-ups';
import { evaluateAutomationPreflight } from '../src/server/services/automation-preflight.service';

// Use the actual shared snapshot and production preflight; no database or portal.
const fixture = JSON.parse(readFileSync('tests/fixtures/automation-job-v2-building-warrant.json', 'utf8'));
const base = () => {
  const snapshot = structuredClone(fixture);
  snapshot.organisation.agent.buildingNumber = '1';
  snapshot.buildingWarrant.typeOfWorkKeys = ['domestic_alteration_extension'];
  return snapshot;
};
assert.equal(evaluateAutomationPreflight(base()).status, 'READY', 'ordinary saved extension without design certificate remains runnable');
for (const workType of ['conversion_change_of_use', 'demolition']) {
  const snapshot = base();
  snapshot.buildingWarrant.typeOfWorkKeys = [workType];
  const result = evaluateAutomationPreflight(snapshot);
  assert.equal(result.status, 'NEEDS_INPUT');
  assert.ok(result.missing.some(issue => issue.code === (workType === 'demolition' ? 'missing_demolition_weeks' : 'missing_conversion_descriptions')));
  if (workType === 'demolition') snapshot.buildingWarrant.demolitionWeeks = 4;
  else snapshot.buildingWarrant.conversionDescriptions = ['C2', 'C9'];
  assert.equal(evaluateAutomationPreflight(snapshot).status, 'READY');
}
for (const field of ['applicationIsStaged', 'intendedLifeFiveYearsOrLess', 'restrictPublicInspection']) {
  const snapshot = base();
  snapshot.buildingWarrant.unusualAnswers[field] = true;
  const before = structuredClone(snapshot);
  const result = evaluateAutomationPreflight(snapshot);
  assert.equal(result.status, 'NEEDS_INPUT', `${field}=Yes is held before a portal run`);
  assert.ok(result.missing.some(issue => issue.field === `buildingWarrant.unusualAnswers.${field}`));
  assert.deepEqual(snapshot, before, 'preflight preserves the saved truthful answer');
}
const certificate = base();
certificate.buildingWarrant.unusualAnswers.certifierOfDesignCertificateAvailable = true;
assert.ok(evaluateAutomationPreflight(certificate).missing.some(issue => issue.field === 'buildingWarrant.certifier.registrationAPart1'));
certificate.buildingWarrant.unusualAnswers.certifierOfDesignCertificateAvailable = false;
assert.ok(!evaluateAutomationPreflight(certificate).missing.some(issue => issue.field.startsWith('buildingWarrant.certifier.')));
console.log('Warrant mapping preflight: mapped work branches, stale policy and certificate choice passed.');

const normalised = buildingWarrantPreparationSchema.parse({ applicantIsOwner: false, workStartedBeforeApplication: true, dangerousBuildingNotice: true });
assert.equal(normalised.applicantIsOwner, false);
assert.equal(normalised.workStartedBeforeApplication, false);
assert.equal(normalised.dangerousBuildingNotice, true, 'dangerous notice remains selectable after the new capture');
const stale = base();
stale.buildingWarrant.unusualAnswers.workStartedBeforeApplication = true;
assert.ok(evaluateAutomationPreflight(stale).missing.some(issue => issue.code === 'outdated_warrant_work_started'));
for (const [answer, field, text] of [
  ['fireAndRescueServiceEnforcingAuthority', 'fireAuthorityName', 'Local authority'],
  ['otherHistoricalImportance', 'historicalBuildingDetails', 'Associated with a historical event'],
  ['dangerousBuildingNotice', 'dangerousBuildingReferences', 'DBN-100; DBN-200'],
] as const) {
  const snapshot = base();
  snapshot.buildingWarrant.unusualAnswers[answer] = answer !== 'fireAndRescueServiceEnforcingAuthority';
  assert.ok(evaluateAutomationPreflight(snapshot).missing.some(issue => issue.field === `buildingWarrant.${field}`));
  snapshot.buildingWarrant[field] = text;
  assert.equal(evaluateAutomationPreflight(snapshot).status, 'READY');
}
const relaxation = base();
relaxation.buildingWarrant.unusualAnswers.scottishMinistersRelaxationDirection = true;
assert.equal(evaluateAutomationPreflight(relaxation).missing.filter(issue => issue.field.includes('relaxation')).length, 2);
Object.assign(relaxation.buildingWarrant, { relaxationReference: 'RD-1', relaxationDate: '2026-11-01' });
assert.equal(evaluateAutomationPreflight(relaxation).status, 'READY');
const form = buildingWarrantPreparationUpdateSchema.parse({
  typeOfWorkKeys: ['new_build'], applicantIsOwner: false, workStartedBeforeApplication: true,
  applicationIsStaged: false, intendedLifeFiveYearsOrLess: false, fireAndRescueServiceEnforcingAuthority: false,
  listedBuildingOrConservationArea: false, otherHistoricalImportance: true, scottishMinistersRelaxationDirection: true,
  dangerousBuildingNotice: true, approvedCertifierOfConstruction: false, coveredBySTAS: false, restrictPublicInspection: false,
  fireAuthorityName: 'Local authority', historicalBuildingDetails: 'History', dangerousBuildingReferences: 'DB-1',
  relaxationReference: 'RD-1', relaxationDate: '2026-11-01', higherLevelsSustainability: 'true',
  sustainabilityMultipleBuildings: 'false', sustainabilityDomesticUse: 'true', sustainabilityNonDomesticUse: 'false',
  sustainabilityDomesticLevels: ['platinum', 'silver', 'gold', 'silver', 'gold', 'silver', 'gold', 'silver'],
  certifierOfConstructionCertificateAvailable: '',
});
assert.equal(form.workStartedBeforeApplication, false);
assert.equal(form.applicantIsOwner, false);
assert.equal(form.certifierOfConstructionCertificateAvailable, undefined, 'blank optional construction-certificate answer is accepted');
const newBuild = base();
newBuild.buildingWarrant.typeOfWorkKeys = ['new_build'];
assert.ok(evaluateAutomationPreflight(newBuild).missing.some(issue => issue.field === 'buildingWarrant.sustainability.higherLevels'));
newBuild.buildingWarrant.sustainability = { higherLevels: false };
assert.equal(evaluateAutomationPreflight(newBuild).status, 'READY');
newBuild.buildingWarrant.sustainability = sustainabilityFromForm(form);
assert.equal(evaluateAutomationPreflight(newBuild).status, 'READY');
newBuild.buildingWarrant.sustainability.domesticLevels[3] = '';
assert.ok(evaluateAutomationPreflight(newBuild).missing.some(issue => issue.field === 'buildingWarrant.sustainability.domesticLevels.3'));
assert.throws(() => buildingWarrantPreparationUpdateSchema.parse({ ...form, fireAuthorityName: 'x'.repeat(21) }));
assert.throws(() => buildingWarrantPreparationUpdateSchema.parse({ ...form, historicalBuildingDetails: 'x'.repeat(751) }));
assert.throws(() => buildingWarrantPreparationUpdateSchema.parse({ ...form, dangerousBuildingReferences: 'x'.repeat(751) }));
assert.throws(() => buildingWarrantPreparationUpdateSchema.parse({ ...form, relaxationDate: '2026-02-30' }));
assert.throws(() => buildingWarrantPreparationUpdateSchema.parse({ ...form, sustainabilityDomesticLevels: ['platinum', 'bronze_active'] }));
console.log('Fixed answers, captured follow-ups, date/length limits and new-building sustainability passed.');

const owner = ownerFromForm({ ownerTitle: 'Other', ownerOtherTitle: 'Dr', ownerFirstName: 'Manual', ownerLastName: 'Owner',
  ownerTelephone: '01410000000', ownerEmail: 'owner@example.test', ownerBuildingName: 'Owner House', ownerAddressLine1: 'Owner Street',
  ownerTownCity: 'Glasgow', ownerCountry: 'United Kingdom', ownerPostcode: 'G1 1AA' });
assert.deepEqual(missingOwnerDetails(owner), []);
const owned = base();
owned.buildingWarrant.unusualAnswers.applicantIsOwner = false;
assert.ok(evaluateAutomationPreflight(owned).missing.some(issue => issue.field === 'buildingWarrant.ownerIsClient'));
owned.buildingWarrant.ownerIsClient = false;
owned.buildingWarrant.owner = resolveWarrantOwner({ ownerIsClient: false, ownerDetails: owner }, null);
assert.equal(evaluateAutomationPreflight(owned).status, 'READY');
const clientOwner = resolveWarrantOwner({ ownerIsClient: true, ownerDetails: owner }, { title: 'Ms', firstName: 'Saved', lastName: 'Client',
  phone: '01410000000', email: 'client@example.test', buildingNumber: '10', addressLine1: 'Client Street', townCity: 'Glasgow', postcode: 'G1 1AA' });
assert.equal(clientOwner?.firstName, 'Saved', 'client choice uses the saved client rather than manual or applicant details');
assert.equal(clientOwner?.source, 'CLIENT');
assert.deepEqual(missingOwnerDetails(clientOwner), []);
console.log('Owner client reuse, manual details and required-field preflight passed.');

const all = base();
all.project.buildingUse = 'commercial';
all.buildingWarrant.typeOfWorkKeys = ['new_build', 'conversion_change_of_use', 'demolition'];
Object.assign(all.buildingWarrant.unusualAnswers, { listedBuildingOrConservationArea: true, coveredBySTAS: true, approvedCertifierOfConstruction: true, certifierOfConstructionCertificateAvailable: true });
assert.ok(evaluateAutomationPreflight(all).missing.some(issue => issue.field === 'buildingWarrant.listingCategory'));
Object.assign(all.buildingWarrant, { conversionDescriptions: ['C1', 'C4'], demolitionWeeks: 12, listingCategory: 'Category B', stasReference: 'STAS-123', sustainability: { higherLevels: false },
  constructionCertificate: { schemeType: '2', certifierName: 'Approved certifier', registrationNumber: 'AC-1', approvedBody: 'Approved body', approvedBodyRegistrationNumber: 'AB-1', workTypeDetails: 'Electrical installation' } });
assert.equal(evaluateAutomationPreflight(all).status, 'READY', 'all captured branches with supplied details are runnable');
all.buildingWarrant.unusualAnswers.declarationAuthorised = false;
assert.ok(evaluateAutomationPreflight(all).missing.some(issue => issue.code === 'missing_declaration_authorisation'));
const noScreen = base(); noScreen.project.buildingUse = null;
assert.ok(evaluateAutomationPreflight(noScreen).missing.some(issue => issue.field === 'project.buildingUse'));
console.log('All supplied follow-up branches, project screening and declaration authorisation passed.');

const multipleDirections = base();
multipleDirections.buildingWarrant.unusualAnswers.scottishMinistersRelaxationDirection = true;
multipleDirections.buildingWarrant.relaxationDirections = [{ reference: 'RD-A', date: '2026-11-01' }, { reference: 'RD-B', date: '' }];
assert.ok(evaluateAutomationPreflight(multipleDirections).missing.some(issue => issue.field === 'buildingWarrant.relaxationDirections.1.date'));
multipleDirections.buildingWarrant.relaxationDirections[1].date = '2026-11-02';
assert.equal(evaluateAutomationPreflight(multipleDirections).status, 'READY');

const missingScreenWork = base(); missingScreenWork.project.typeOfWorkKeys = [];
assert.ok(evaluateAutomationPreflight(missingScreenWork).missing.some(issue => issue.field === 'project.typeOfWorkKeys'), 'an unknown legacy project type cannot silently become an extension');

// Preparation pages: every preflight field used on the warrant page links to the section that answers it.
for (const [field, section] of [
  ['documents.locationPlan', null], ['project.buildingUse', 'details'], ['buildingWarrant.description', 'details'], ['buildingWarrant.conversionDescriptions', 'details'],
  ['buildingWarrant.ownerIsClient', 'questions'], ['buildingWarrant.owner.buildingNumber', 'questions'],
  ['buildingWarrant.fireAuthorityName', 'questions'], ['buildingWarrant.listingCategory', 'questions'], ['buildingWarrant.relaxationDirections.0.date', 'questions'], ['buildingWarrant.stasReference', 'questions'],
  ['buildingWarrant.sustainability.higherLevels', 'sustainability'],
  ['buildingWarrant.certifier.approvedBody', 'certificates'], ['buildingWarrant.constructionCertificate.schemeType', 'certificates'], ['buildingWarrant.designCertificateWithApplication', 'certificates'],
  ['buildingWarrant.feeCalculation', 'fee'], ['buildingWarrant.unusualAnswers.declarationAuthorised', 'declaration'],
] as const) assert.equal(warrantSectionForRequirement(field), section, `${field} links to ${section}`);

// Planning: parking is not posted without vehicle access, and stays required with it.
const planningBody = { description: 'Extension', discussedWithPlanningAuthority: 'false', treesOnOrAdjacentToSite: 'false', soleOwner: 'true', agriculturalHolding: 'false', applicationFee: '300' };
assert.equal(planningPreparationDetailsSchema.safeParse({ ...planningBody, newOrAlteredVehicleAccess: 'false' }).success, true, 'hidden parking fields are not required');
assert.equal(planningPreparationDetailsSchema.safeParse({ ...planningBody, newOrAlteredVehicleAccess: 'true' }).success, false, 'vehicle access still requires parking');
assert.equal(planningPreparationDetailsSchema.safeParse({ ...planningBody, newOrAlteredVehicleAccess: 'true', currentParkingSpaces: '1', proposedParkingSpaces: '2' }).success, true);
