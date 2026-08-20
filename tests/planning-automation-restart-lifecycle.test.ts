import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const restartRoute = source('src/pages/api/automation-jobs/[id]/restart.ts');
const completionRoute = source('src/pages/api/planning/[id]/complete-details.ts');
const preparationPage = source('src/pages/planning/[id]/preparation.astro');
const statusPanel = source('src/components/automation/DesktopAutomationStatus.astro');
const liveStatusPanel = source('src/components/automation/DesktopAutomationLiveCard.tsx');
const launchButton = source('src/components/automation/AutomationLaunchButton.tsx');

assert.match(
  restartRoute,
  /const newJobId = randomUUID\(\)[\s\S]*buildAutomationJobSnapshot\(\{[\s\S]*jobId: newJobId/,
  'restart creates a distinct job identity and builds its snapshot for that identity',
);
assert.match(
  restartRoute,
  /planningApplicationId: oldJob\.type === AutomationJobType\.BUILDING_WARRANT[\s\S]*buildingWarrantApplicationId: oldJob\.type === AutomationJobType\.BUILDING_WARRANT/,
  'retry preserves the exact application identity for Planning and shared Building Warrant snapshots',
);
assert.doesNotMatch(
  restartRoute,
  /oldJob\.(documentSnapshot|resultData|resultSummary|lastCheckpoint)/,
  'restart never copies the old execution snapshot or proposal resume state',
);
assert.match(
  restartRoute,
  /oldJob\.status !== AutomationJobStatus\.FAILED_RETRYABLE \|\| oldJob\.completedAt/,
  'only an unconsumed runner-confirmed retryable failure can enter the retry path',
);
assert.match(
  restartRoute,
  /status: AutomationJobStatus\.FAILED_RETRYABLE,[\s\S]*completedAt: null,[\s\S]*data: \{ completedAt: authorisedAt \}/,
  'retry atomically consumes the failed attempt so duplicate active jobs cannot be created',
);
assert.match(
  restartRoute,
  /status: AutomationJobStatus\.READY,[\s\S]*executionAuthorisedAt: authorisedAt/,
  'the replacement is queued and authorised for automatic Agent discovery',
);
assert.match(restartRoute, /organisationId: organisation\.id/, 'retry lookup and mutation remain organisation scoped');
assert.match(restartRoute, /agentSupportsJob[\s\S]*ensureWaitingForAgentAction/, 'retry uses the existing automatic Agent compatibility and waiting flow');
assert.doesNotMatch(restartRoute, /preparationRedirectTo/, 'retry does not send the user back through manual preparation');

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
assert.doesNotMatch(statusPanel, /RestartAutomationJobButton|startedStatuses/);
assert.doesNotMatch(liveStatusPanel, /Restart desktop automation/, 'running and fee-paused cards do not offer a competing restart action');
assert.match(liveStatusPanel, /Retry application/, 'the failure card owns the state-driven retry action');
assert.match(liveStatusPanel, /setCurrentJobId\(result\.job\.id\)/, 'the retry state replaces the failed projection live');
assert.doesNotMatch(launchButton, /RestartAutomationJobButton|Restart desktop automation/, 'the old generic restart control is removed');

console.log('Planning automation restart lifecycle regression tests passed');
