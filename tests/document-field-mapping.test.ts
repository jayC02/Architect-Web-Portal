import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ApplicationDraftType } from '@prisma/client';
import { documentFactFieldKeys } from '../src/lib/validation/document-intelligence';
import {
  applicantFactsFromOneParty,
  buildingUseFrom,
  countFrom,
  explicitTypeOfWork,
  overallDescriptionFromFacts,
  planningAnswersFromPrepared,
  yesNoFrom,
} from '../src/server/services/application-draft.service';
import { GEMINI_DOCUMENT_RESPONSE_SCHEMA } from '../src/server/services/pdf-classification.service';

// Type of work: document wording, portal labels and stored keys all resolve.
assert.equal(explicitTypeOfWork('New house'), 'new_build');
assert.equal(explicitTypeOfWork('New build'), 'new_build');
assert.equal(explicitTypeOfWork('new_build'), 'new_build', 'a prepared key round-trips into the review');
assert.equal(explicitTypeOfWork('conversion_change_of_use'), 'conversion_change_of_use');
assert.equal(explicitTypeOfWork('Conversion / change of use'), 'conversion_change_of_use');
assert.equal(explicitTypeOfWork('Domestic alteration / extension'), 'domestic_alteration_extension');
assert.equal(explicitTypeOfWork('Erection of extension'), 'domestic_alteration_extension');
assert.equal(explicitTypeOfWork('Erection of a dwelling house'), 'new_build');
assert.equal(explicitTypeOfWork('Demolition of garage'), 'demolition');
assert.equal(explicitTypeOfWork(''), null);
assert.equal(explicitTypeOfWork('Landscaping'), null);

// Building use.
assert.equal(buildingUseFrom('Residential'), 'residential');
assert.equal(buildingUseFrom('Residential dwelling'), 'residential');
assert.equal(buildingUseFrom('Commercial'), 'commercial');
assert.equal(buildingUseFrom('Office'), 'commercial');
assert.equal(buildingUseFrom('Unknown'), null);
for (const use of ['Non-domestic', 'Non-residential', 'Warehouse', 'Care home', 'Residential care home', 'Public house', 'Guest house', 'Farm building']) {
  assert.equal(buildingUseFrom(use), 'commercial', `${use} is not residential`);
}
for (const use of ['Dwelling house', 'Domestic', 'Flats', 'Holiday cottage', 'Bungalow']) {
  assert.equal(buildingUseFrom(use), 'residential', `${use} is residential`);
}

// Yes/no and counts.
assert.equal(yesNoFrom('Yes'), true);
assert.equal(yesNoFrom('No'), false);
assert.equal(yesNoFrom(true), true);
assert.equal(yesNoFrom('Possibly'), null);
assert.equal(countFrom('3'), 3);
assert.equal(countFrom('Parking for three vehicles'), null, 'only a leading number word counts');
assert.equal(countFrom('three'), 3);
assert.equal(countFrom(0), 0);
assert.equal(countFrom('none'), 0);
assert.equal(countFrom(-1), null);

// Planning answers from the drawings pre-fill only planning reviews.
const suggestion = (value: string | number | boolean | null) => ({
  value,
  status: value === null ? 'missing' as const : 'suggested' as const,
  certainty: 'medium' as const,
  sources: [],
});
const application = {
  treesOnOrAdjacentToSite: suggestion(true),
  newOrAlteredVehicleAccess: suggestion(true),
  currentParkingSpaces: suggestion(0),
  proposedParkingSpaces: suggestion(3),
};
assert.deepEqual(planningAnswersFromPrepared(ApplicationDraftType.HOUSEHOLDER_PLANNING, application), {
  treesOnOrAdjacentToSite: true,
  newOrAlteredVehicleAccess: true,
  currentParkingSpaces: 0,
  proposedParkingSpaces: 3,
});
assert.deepEqual(
  planningAnswersFromPrepared(ApplicationDraftType.BUILDING_WARRANT, application),
  {},
  'planning answers never leak into building warrant declarations',
);
assert.deepEqual(
  planningAnswersFromPrepared(ApplicationDraftType.PLANNING_APPLICATION, { proposedParkingSpaces: suggestion(null) }),
  {},
  'missing answers leave the defaults in place',
);
assert.deepEqual(
  planningAnswersFromPrepared(ApplicationDraftType.HOUSEHOLDER_PLANNING, {
    treesOnOrAdjacentToSite: { ...suggestion(true), status: 'conflict' as const, currentValue: false },
    proposedParkingSpaces: suggestion(3),
  }),
  { proposedParkingSpaces: 3 },
  'an answer the sheets disagree on is left for the architect',
);

// Description of work comes from the sheet that shows the whole proposal.
const fact = (fieldKey: string, value: string, documentId: string, certainty: 'high' | 'medium' | 'low' = 'high') => ({
  fieldKey, value, documentId, filename: `${documentId}.pdf`, evidence: 'Title block', certainty,
});
const categories = new Map([['ground', 'proposed_plans'], ['site', 'site_block_plan'], ['electric', 'proposed_plans']]);
const description = overallDescriptionFromFacts([
  fact('application.descriptionOfWork', 'Ground floor layout for a new house at Daviot', 'ground'),
  fact('application.descriptionOfWork', 'Erection of a dwelling house on Plot 3 with new access', 'site', 'medium'),
  fact('application.descriptionOfWork', 'Electrical layout for a new house', 'electric'),
], categories);
assert.equal(description.value, 'Erection of a dwelling house on Plot 3 with new access', 'the site plan wins over a floor plan');
assert.equal(description.status, 'suggested', 'differing free-text wording is not a conflict');
assert.equal(description.sources[0].documentId, 'site');
assert.equal(
  overallDescriptionFromFacts([fact('application.descriptionOfWork', 'Erection of a house', 'ground')], categories).value,
  'Erection of a house',
  'any sheet is used when no better sheet has a description',
);
assert.equal(overallDescriptionFromFacts([], categories).value, null);

// Applicant details come from one party; a second party is reported, not merged in.
const daviot = applicantFactsFromOneParty([
  fact('applicant.companyName', 'Prestige Properties Highland Ltd.', 'site'),
  fact('applicant.townCity', 'Inverness', 'site'),
  ...['ground', 'electric', 'sections'].flatMap((id) => [
    fact('applicant.firstName', 'D', id),
    fact('applicant.lastName', 'Glennie', id),
  ]),
  fact('project.title', 'New house at Daviot', 'ground'),
]);
assert.equal(daviot.chosen?.label, 'D Glennie', 'the party on most sheets is used');
assert.deepEqual(daviot.others.map((party) => party.label), ['Prestige Properties Highland Ltd.']);
assert.ok(daviot.facts.every((item) => item.fieldKey.startsWith('applicant.')), 'only applicant facts are returned');
assert.ok(!daviot.facts.some((item) => item.value === 'Prestige Properties Highland Ltd.'), 'the other company is not merged in');
assert.ok(!daviot.facts.some((item) => item.value === 'Inverness'), "the other party's address is not merged in");

const oneParty = applicantFactsFromOneParty([
  fact('applicant.companyName', 'Prestige Properties Highland Ltd.', 'site'),
  fact('applicant.companyName', 'Prestige Properties Highland Limited', 'ground'),
  fact('applicant.email', 'office@example.com', 'ground'),
]);
assert.equal(oneParty.chosen, null, 'Ltd and Limited are the same company');
assert.equal(oneParty.facts.length, 3);
assert.equal(
  applicantFactsFromOneParty([fact('applicant.firstName', 'D', 'a'), fact('applicant.lastName', 'Glennie', 'a'),
    fact('applicant.title', 'Mr', 'b'), fact('applicant.lastName', 'Glennie', 'b')]).chosen,
  null,
  'the same surname with or without an initial is one person',
);

// The AI schema offers every fact key the portal reads.
const schemaKeys = (GEMINI_DOCUMENT_RESPONSE_SCHEMA.properties.extractedFacts.items.properties.key.enum as readonly string[]);
assert.deepEqual([...schemaKeys], [...documentFactFieldKeys]);
for (const key of ['project.buildingUse', 'planning.treesOnOrAdjacentToSite', 'planning.newOrAlteredVehicleAccess',
  'planning.currentParkingSpaces', 'planning.proposedParkingSpaces']) {
  assert.ok((documentFactFieldKeys as readonly string[]).includes(key), key);
}

// The prompt explains every fact key, so a model doesn't have to guess what each one means.
const classifier = fs.readFileSync('src/server/services/pdf-classification.service.ts', 'utf8');
const prompt = classifier.slice(classifier.indexOf('const buildPrompt'), classifier.indexOf('const responseTextFromOpenAi'));
for (const key of documentFactFieldKeys.filter((value) => value !== 'applicant.clientType')) {
  const [group] = key.split('.');
  assert.ok(prompt.includes(key) || prompt.includes(`${group}.*`), `prompt describes ${key}`);
}
assert.match(prompt, /agent\.\*: the architect/, 'the architect is recorded as the agent, not skipped');
assert.match(prompt, /Use warnings only for problems a reviewer must act on/, 'missing details are not warnings');
assert.match(prompt, /Proposed new planting is not a reason for "Yes"/, 'trees means existing trees');
assert.match(prompt, /Describe the development, never this sheet/, 'the description is of the whole proposal');

// Disagreements are shown on the review screen.
const reviewUi = fs.readFileSync('src/components/applications/ApplicationDraftReview.tsx', 'utf8');
const clientUi = fs.readFileSync('src/components/applications/ClientApplicantReview.tsx', 'utf8');
assert.match(reviewUi, /<DocumentConflicts prepared=\{draft\.prepared\} sections=\{\['project', 'application'\]\} \/>/);
assert.match(reviewUi, /<DocumentConflicts prepared=\{draft\.prepared\} sections=\{\['site'\]\} \/>/);
assert.match(clientUi, /preparedApplicantConflict\(draft\)/);

console.log('document field mapping tests passed');
