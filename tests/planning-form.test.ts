// Householder or Planning Permission, decided from the drawings (docs/superpowers/specs/2026-11-28-applications-section-design.md).
import assert from 'node:assert/strict';
import {
  effectivePlanningForm,
  planningFormForJobType,
  PLANNING_FORMS,
  readPlanningForm,
  suggestPlanningForm,
} from '../src/lib/planning-form';
import { APPLICATION_FORMS, APPLICATION_PORTALS, formsForPortal } from '../src/lib/application-forms';

const fact = (fieldKey: string, value: string) => ({ fieldKey, value });
const residential = { buildingUse: 'residential', typeOfWorkKeys: ['domestic_alteration_extension'] };

// The drawings decide, and the reason quotes them.
const extension = suggestPlanningForm({ ...residential, facts: [fact('application.descriptionOfWork', 'Single-storey rear extension to existing house')] });
assert.equal(extension?.form, 'HOUSEHOLDER');
assert.equal(extension?.source, 'drawings');
assert.match(extension!.reason, /Single-storey rear extension to existing house/);

assert.equal(suggestPlanningForm({ ...residential, facts: [fact('project.typeOfWork', 'New build')] })?.form, 'PLANNING_PERMISSION');
assert.equal(suggestPlanningForm({ ...residential, facts: [fact('application.descriptionOfWork', 'Erection of a single-storey dwelling house with parking')] })?.form, 'PLANNING_PERMISSION');
assert.equal(suggestPlanningForm({ ...residential, facts: [fact('application.proposedUse', 'Residential dwelling'), fact('application.currentUse', 'Office')] })?.form, 'PLANNING_PERMISSION', 'a change of use');
const flat = suggestPlanningForm({ ...residential, facts: [fact('application.descriptionOfWork', 'Alterations to first floor flat')] });
assert.equal(flat?.form, 'PLANNING_PERMISSION');
assert.match(flat!.reason, /flat/i);
assert.equal(suggestPlanningForm({ ...residential, facts: [fact('project.buildingUse', 'Commercial')] })?.form, 'PLANNING_PERMISSION');

// Sheets that disagree: anything that needs full permission wins.
const mixed = suggestPlanningForm({ ...residential, facts: [
  fact('application.descriptionOfWork', 'Rear extension'),
  fact('application.descriptionOfWork', 'Formation of a new flat in the roof space'),
] });
assert.equal(mixed?.form, 'PLANNING_PERMISSION');
assert.match(mixed!.reason, /new flat/);

// Without drawings the project scope decides.
const commercial = suggestPlanningForm({ buildingUse: 'commercial', typeOfWorkKeys: ['domestic_alteration_extension'], facts: [] });
assert.equal(commercial?.form, 'PLANNING_PERMISSION');
assert.equal(commercial?.source, 'scope');
assert.equal(suggestPlanningForm({ ...residential, facts: [] })?.form, 'HOUSEHOLDER');
assert.equal(suggestPlanningForm({ buildingUse: 'residential', typeOfWorkKeys: ['conversion_change_of_use'], facts: [] })?.form, 'PLANNING_PERMISSION');
assert.equal(suggestPlanningForm({ buildingUse: null, typeOfWorkKeys: [], facts: [] }), null, 'nothing to go on');

// Stored choice, then the latest run, then the suggestion, then Householder.
const stored = { form: 'PLANNING_PERMISSION' as const, chosenBy: 'USER' as const, reason: null, suggestedForm: 'HOUSEHOLDER' as const, chosenAt: '2026-11-28T10:00:00.000Z' };
assert.deepEqual(readPlanningForm({ planningForm: stored }), stored);
assert.equal(readPlanningForm({ planningForm: { form: 'OUTLINE' } }), null);
assert.equal(readPlanningForm(null), null);
assert.equal(effectivePlanningForm({ stored, latestJobType: 'HOUSEHOLDER_PLANNING', suggestion: extension }).form, 'PLANNING_PERMISSION');
assert.equal(effectivePlanningForm({ stored, latestJobType: null, suggestion: null }).chosenBy, 'USER');
assert.deepEqual(effectivePlanningForm({ stored: null, latestJobType: 'PLANNING_APPLICATION', suggestion: extension }), { form: 'PLANNING_PERMISSION', chosenBy: 'RUN', reason: null });
assert.equal(effectivePlanningForm({ stored: null, latestJobType: null, suggestion: flat }).chosenBy, 'SUGGESTED');
assert.deepEqual(effectivePlanningForm({ stored: null, latestJobType: null, suggestion: null }), { form: 'HOUSEHOLDER', chosenBy: 'DEFAULT', reason: null });
assert.equal(planningFormForJobType('PLANNING_APPLICATION'), 'PLANNING_PERMISSION');
assert.equal(planningFormForJobType('BUILDING_WARRANT'), null);
assert.equal(PLANNING_FORMS.HOUSEHOLDER.jobType, 'HOUSEHOLDER_PLANNING');
assert.equal(PLANNING_FORMS.PLANNING_PERMISSION.jobType, 'PLANNING_APPLICATION');

// The forms list: every form sits under a known portal, in page order.
assert.deepEqual(APPLICATION_FORMS.map((form) => form.key), ['PLANNING', 'BUILDING_WARRANT', 'COMPLETION_CERTIFICATE']);
for (const form of APPLICATION_FORMS) assert.ok(APPLICATION_PORTALS[form.portal], `${form.key} has a portal`);
assert.deepEqual(formsForPortal('EPLANNING').map((form) => form.key), ['PLANNING']);
assert.deepEqual(formsForPortal('EBUILDING_STANDARDS').map((form) => form.key), ['BUILDING_WARRANT', 'COMPLETION_CERTIFICATE']);

console.log('planning-form: ok');
