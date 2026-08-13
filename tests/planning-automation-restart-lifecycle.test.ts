import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const restartRoute = source('src/pages/api/automation-jobs/[id]/restart.ts');
const completionRoute = source('src/pages/api/planning/[id]/complete-details.ts');
const preparationPage = source('src/pages/planning/[id]/preparation.astro');
const statusPanel = source('src/components/automation/DesktopAutomationStatus.astro');
const launchButton = source('src/components/automation/AutomationLaunchButton.tsx');

assert.match(
  restartRoute,
  /const newJobId = randomUUID\(\)[\s\S]*buildAutomationJobSnapshot\(\{[\s\S]*jobId: newJobId/,
  'restart creates a distinct job identity and builds its snapshot for that identity',
);
assert.match(
  restartRoute,
  /planningApplicationId: identity\.applicationId/,
  'restart preserves only the exact current Planning application identity',
);
assert.doesNotMatch(
  restartRoute,
  /oldJob\.(documentSnapshot|resultData|resultSummary|lastCheckpoint)/,
  'restart never copies the old execution snapshot or proposal resume state',
);
assert.match(
  restartRoute,
  /status: oldJob\.status[\s\S]*status: AutomationJobStatus\.CANCELLED[\s\S]*automationJob\.create/,
  'the old attempt is conditionally cancelled before the fresh job is inserted',
);
assert.match(
  restartRoute,
  /dataSnapshot: snapshot\.dataSnapshot[\s\S]*documentSnapshot: snapshot\.documentSnapshot/,
  'the replacement stores the newly built canonical data and document snapshots',
);
assert.doesNotMatch(
  restartRoute,
  /resultData:|resultSummary:|lastCheckpoint:|claimedByUserId:/,
  'the replacement starts without old desktop execution or proposal metadata',
);

assert.match(
  completionRoute,
  /if \(job && automationJobApplicationId\(job\) !== application\.id\) \{\s*job = null;/,
  'a mismatched old job is ignored while canonical Planning data is saved',
);
assert.doesNotMatch(
  completionRoute,
  /body\.jobId && \(!job/,
  'a consumed or unavailable job id no longer blocks canonical edits',
);
assert.match(
  preparationPage,
  /editableJobStatuses\.has\(candidate\.status\)[\s\S]*automationJobApplicationId\(candidate\) === application\.id/,
  'started historical jobs are not submitted as editable preparation state',
);
assert.match(statusPanel, /RestartAutomationJobButton[\s\S]*startedStatuses\.has\(job\.status\)/);
assert.match(launchButton, /\/api\/automation-jobs\/\$\{jobId\}\/restart/);

console.log('Planning automation restart lifecycle regression tests passed');
