import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ApplicationDraftType } from '@prisma/client';
import { documentFactFieldKeys } from '../src/lib/validation/document-intelligence';
import {
  buildingUseFrom,
  countFrom,
  explicitTypeOfWork,
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

console.log('document field mapping tests passed');
