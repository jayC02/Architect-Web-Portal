import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  missingPlanningPermissionAnswers,
  planningPermissionAnswersFromForm,
  planningPermissionFormSchema,
  readPlanningPermissionAnswers,
} from '../src/lib/planning-permission';
import { householderPreparationUpdateSchema, planningPreparationDetailsSchema } from '../src/lib/validation/domain';
import { automationJobSnapshotV2Schema } from '../src/lib/validation/automation-job';
import { evaluateAutomationPreflight } from '../src/server/services/automation-preflight.service';

const completeForm = {
  pp_section: 'true',
  pp_applicationKind: 'FULL',
  pp_temporaryPermission: 'false',
  pp_changeOfUseTakenPlace: 'false',
  pp_worksStarted: 'No',
  pp_siteArea: '250',
  pp_siteAreaUnit: 'sqm',
  pp_existingUse: 'Dwellinghouse and garden',
  pp_publicPathsChanges: 'false',
  pp_waterOrDrainageChanges: 'false',
  pp_sustainableDrainage: 'true',
  pp_publicWaterSupply: 'YES',
  pp_knownFloodRisk: 'NO',
  pp_increasesFloodRisk: 'NO',
  pp_wasteStorage: 'true',
  pp_wasteDetails: 'Bins at the side of the house',
  pp_newDwellings: 'false',
  pp_nonResidentialFloorspace: 'false',
  pp_schedule3: 'NO',
  pp_staffOrMemberInterest: 'false',
};
const parseForm = (values: Record<string, string>) =>
  planningPermissionAnswersFromForm(planningPermissionFormSchema.parse(values));
const context = {
  discussedWithPlanningAuthority: false,
  currentParkingSpaces: 2,
  proposedParkingSpaces: 2,
  soleOwner: true,
  agriculturalHolding: false,
};

// Without the section the page did not ask, so nothing is stored.
assert.equal(parseForm({}), null);

const complete = parseForm(completeForm)!;
assert.equal(complete.siteArea, 250);
assert.equal(complete.applicationKind, 'FULL');
assert.deepEqual(missingPlanningPermissionAnswers(complete, context), [], 'a complete full application has no gaps');

// Follow-ups the chosen route never asks for are cleared, not carried to the portal.
const cleared = parseForm({
  ...completeForm,
  pp_applicationKind: 'PPP',
  pp_earlierApplicationReference: '26/0001/FUL',
  pp_temporaryPermission: 'false',
  pp_temporaryPermissionDetails: 'stale',
  pp_drainageConnection: 'PRIVATE',
  pp_privateDrainageDetails: 'stale',
  pp_floodRiskDetails: 'stale',
})!;
assert.equal(cleared.earlierApplicationReference, null);
assert.equal(cleared.temporaryPermissionDetails, null);
assert.equal(cleared.drainageConnection, null);
assert.equal(cleared.privateDrainageDetails, null);
assert.equal(cleared.floodRiskDetails, null);
assert.equal(cleared.wasteStorage, null, 'PPP never asks about waste');
assert.deepEqual(missingPlanningPermissionAnswers(cleared, { ...context, currentParkingSpaces: null, proposedParkingSpaces: null }), [],
  'PPP does not ask for parking spaces');

// Every branch's follow-ups become required.
const branches = parseForm({
  ...completeForm,
  pp_applicationKind: 'FURTHER',
  pp_temporaryPermission: 'true',
  pp_worksStarted: 'Completed',
  pp_waterOrDrainageChanges: 'true',
  pp_drainageConnection: 'PRIVATE',
  pp_privateDrainageType: 'SEPTIC_TANK',
  pp_increasesFloodRisk: 'YES',
  pp_nonResidentialFloorspace: 'true',
  pp_floorspace_0_useClass: "Don't know",
  pp_floorspace_0_gross: '12',
  pp_staffOrMemberInterest: 'true',
})!;
const gapFields = missingPlanningPermissionAnswers(branches, { ...context, discussedWithPlanningAuthority: true })
  .map(gap => gap.field.replace('planning.answers.', ''));
for (const field of [
  'earlierApplicationReference', 'earlierApplicationDate', 'temporaryPermissionDetails', 'worksDate', 'worksReason',
  'preApplicationFormat', 'preApplicationFeedback', 'septicTankDischarge', 'privateDrainageDetails',
  'floodRiskDetails', 'floorspaceEntries.0.details', 'staffOrMemberInterestDetails',
]) {
  assert.ok(gapFields.includes(field), `missing ${field} must be reported`);
}
assert.ok(!gapFields.includes('wasteStorage'), 'a further application never asks about waste');
assert.deepEqual(branches.floorspaceEntries, [{
  useClass: "Don't know", grossFloorspace: 12, netTradingSpace: null, nonTradingSpace: null, details: null,
}]);

// An unanswered application lists the core questions, not defaults.
const empty = missingPlanningPermissionAnswers({}, { ...context, currentParkingSpaces: null, proposedParkingSpaces: null })
  .map(gap => gap.field.replace('planning.answers.', ''));
for (const field of ['siteArea', 'existingUse', 'currentParkingSpaces', 'waterOrDrainageChanges', 'sustainableDrainage',
  'publicWaterSupply', 'knownFloodRisk', 'increasesFloodRisk', 'wasteStorage', 'wasteDetails', 'newDwellings',
  'nonResidentialFloorspace', 'schedule3']) {
  assert.ok(empty.includes(field), `${field} is required`);
}

// Only the Certificate C route with nobody to notify is released.
const ownership = (answers = complete, overrides: Partial<typeof context> = {}) =>
  missingPlanningPermissionAnswers(answers, { ...context, ...overrides }).map(gap => gap.field);
assert.ok(ownership(complete, { soleOwner: false }).includes('planning.answers.identifyAllOtherOwners'));
assert.ok(ownership(complete, { agriculturalHolding: true }).includes('planning.answers.agriculturalHolding'));
assert.ok(ownership({ ...complete, identifyAllOtherOwners: true }, { soleOwner: false }).includes('planning.answers.identifyAllOtherOwners'));
assert.ok(ownership({ ...complete, identifyAllOtherOwners: false, noticeToOneOwner: true }, { soleOwner: false }).includes('planning.answers.noticeToOneOwner'));
const certificateC = {
  ...complete, identifyAllOtherOwners: false, noticeToOneOwner: false,
  ownershipReasonableSteps: 'Checked the available ownership records.',
  ownershipNoticesAcknowledged: true,
};
assert.deepEqual(ownership(certificateC, { soleOwner: false }), []);
assert.ok(ownership({ ...certificateC, ownershipNoticesAcknowledged: false }, { soleOwner: false })
  .includes('planning.answers.ownershipNoticesAcknowledged'));
assert.ok(ownership({ ...certificateC, ownershipReasonableSteps: '' }, { soleOwner: false })
  .includes('planning.answers.ownershipReasonableSteps'));

// Stored answers that no longer validate are dropped rather than sent.
assert.deepEqual(readPlanningPermissionAnswers({ siteArea: 'lots', schedule3: 'NO', unknown: 1 }), { schedule3: 'NO' });

// The preparation API accepts the prefixed fields alongside the shared questions.
const body = planningPreparationDetailsSchema.parse({
  description: 'Garage', discussedWithPlanningAuthority: 'false', treesOnOrAdjacentToSite: 'false',
  newOrAlteredVehicleAccess: 'false', soleOwner: 'true', agriculturalHolding: 'false', applicationFee: '600',
  ...completeForm,
});
assert.equal(planningPermissionAnswersFromForm(body)?.existingUse, 'Dwellinghouse and garden');
const parkingForm = {
  ...completeForm, newOrAlteredVehicleAccess: 'true', discussedWithPlanningAuthority: 'false',
  treesOnOrAdjacentToSite: 'false', soleOwner: 'true', agriculturalHolding: 'false',
};
assert.equal(planningPreparationDetailsSchema.safeParse({ ...parkingForm, pp_applicationKind: 'PPP' }).success, true);
assert.equal(planningPreparationDetailsSchema.safeParse(parkingForm).success, false);
assert.equal(householderPreparationUpdateSchema.safeParse(parkingForm).success, false);
const confirmedParking = planningPreparationDetailsSchema.parse({
  ...parkingForm, currentParkingSpaces: '0', proposedParkingSpaces: '0',
});
assert.deepEqual([confirmedParking.currentParkingSpaces, confirmedParking.proposedParkingSpaces], [0, 0]);
const ownershipForm = {
  ...completeForm, ...parkingForm, newOrAlteredVehicleAccess: 'false', soleOwner: 'false',
  pp_identifyAllOtherOwners: 'false', pp_noticeToOneOwner: 'false',
  pp_ownershipReasonableSteps: certificateC.ownershipReasonableSteps, pp_ownershipNoticesAcknowledged: 'true',
};
const storedOwnership = planningPermissionAnswersFromForm(planningPreparationDetailsSchema.parse(ownershipForm))!;
assert.deepEqual(storedOwnership, certificateC);
assert.equal(planningPermissionAnswersFromForm(planningPreparationDetailsSchema.parse({
  ...ownershipForm, pp_identifyAllOtherOwners: 'true',
}))?.ownershipNoticesAcknowledged, null);
assert.equal(planningPermissionAnswersFromForm(planningPreparationDetailsSchema.parse({
  ...ownershipForm, soleOwner: 'true',
}))?.identifyAllOtherOwners, null);

// Snapshot contract keeps the answers and preflight blocks a Planning Permission job until they are complete.
const fixture = JSON.parse(readFileSync('tests/fixtures/automation-job-v2-building-warrant.json', 'utf8'));
fixture.organisation.agent.buildingNumber = '1';
fixture.metadata.applicationType = 'PLANNING_APPLICATION';
fixture.buildingWarrant = null;
fixture.planning = {
  recordId: 'planning-1', description: 'Garage', feeMinorUnits: 60000, status: null, applicationReference: null,
  answers: {
    discussedWithPlanningAuthority: false, treesOnOrAdjacentToSite: false, newOrAlteredVehicleAccess: false,
    currentParkingSpaces: 2, proposedParkingSpaces: 2, soleOwner: true, agriculturalHolding: false,
  },
  updatedAt: null,
};
const incomplete = evaluateAutomationPreflight(fixture);
assert.ok(incomplete.missing.some(issue => issue.field === 'planning.answers.siteArea'), 'missing answers block the job');
fixture.planning.answers = { ...fixture.planning.answers, ...complete };
assert.ok(!evaluateAutomationPreflight(fixture).missing.some(issue => issue.field.startsWith('planning.answers.')),
  'complete answers clear the Planning Permission checks');
fixture.planning.answers = { ...fixture.planning.answers, ...storedOwnership, soleOwner: false };
assert.ok(!evaluateAutomationPreflight(fixture).missing.some(issue => issue.field.startsWith('planning.answers.')),
  'the confirmed Certificate C route passes website preflight');
assert.equal(automationJobSnapshotV2Schema.shape.planning.parse(fixture.planning)?.answers.ownershipNoticesAcknowledged, true);
fixture.metadata.applicationType = 'HOUSEHOLDER_PLANNING';
fixture.planning.answers = { ...fixture.planning.answers, siteArea: null };
assert.ok(!evaluateAutomationPreflight(fixture).missing.some(issue => issue.field === 'planning.answers.siteArea'),
  'householder jobs are not asked Planning Permission questions');

const parsed = automationJobSnapshotV2Schema.shape.planning.parse({ ...fixture.planning, answers: { ...fixture.planning.answers, ...complete } });
assert.equal(parsed?.answers.existingUse, 'Dwellinghouse and garden', 'the snapshot contract keeps the answers');

console.log('planning permission answers tests passed');
