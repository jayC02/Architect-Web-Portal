import assert from 'node:assert/strict';
import fs from 'node:fs';

const clientReadiness = fs.readFileSync('src/lib/application-draft-readiness.ts', 'utf8');
const serverReadiness = fs.readFileSync('src/server/services/application-draft.service.ts', 'utf8');
const commitService = fs.readFileSync('src/server/services/application-draft-commit.service.ts', 'utf8');
const commitRoute = fs.readFileSync('src/pages/api/application-drafts/[id]/commit.ts', 'utf8');

for (const source of [clientReadiness, serverReadiness]) {
  assert.doesNotMatch(
    source,
    /key:\s*['"]selectedApplicationType['"][\s\S]{0,180}label:\s*['"]Application route['"]/,
    'automatic application routing must not be presented as a missing user field',
  );
  assert.doesNotMatch(
    source,
    /Choose Building Warrant or Planning \/ Householder\./,
    'the removed application-route prompt must not remain in readiness validation',
  );
}

assert.doesNotMatch(commitService, /Choose an application route/, 'project creation has no route guard');
assert.match(commitService, /const jobId = jobType \? existingJobId \?\? randomUUID\(\) : null/);
assert.match(commitService, /if \(jobType && committedRecords\.automationJobId\)/);
assert.match(
  commitService,
  /selectedApplicationType === ApplicationDraftType\.BUILDING_WARRANT[\s\S]{0,120}selectedApplicationType === ApplicationDraftType\.AUTO/,
  'automatic projects create a Building Warrant record',
);
assert.match(
  commitService,
  /selectedApplicationType === ApplicationDraftType\.HOUSEHOLDER_PLANNING[\s\S]{0,120}selectedApplicationType === ApplicationDraftType\.AUTO/,
  'automatic projects create a Planning record',
);
assert.match(commitRoute, /: projectUrl;/, 'unrouted projects redirect to the normal project page');
assert.doesNotMatch(
  fs.readFileSync('src/components/applications/ApplicationDraftReview.tsx', 'utf8'),
  /Being determined|routeLabel/,
  'the review UI does not display an application route',
);

console.log('application route readiness test passed');
