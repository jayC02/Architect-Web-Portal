import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const restartRoute = source('src/pages/api/automation-jobs/[id]/restart.ts');
const callbackRoute = source('src/pages/api/desktop/automation-jobs/[id]/index.ts');
const normalCreateRoute = source('src/pages/api/automation-jobs/index.ts');
const projectCreateRoute = source('src/pages/api/projects/[id]/automation-jobs.ts');
const snapshotService = source('src/server/services/automation-jobs.service.ts');
const lifecycleService = source('src/server/services/automation-lifecycle.service.ts');
const statusService = source('src/server/services/desktop-automation-status.service.ts');
const prepareRoute = source('src/pages/api/automation-jobs/[id]/prepare.ts');
const preparationMutation = source('src/pages/api/automation-jobs/[id]/preparation.ts');
const completionRoute = source('src/pages/api/planning/[id]/complete-details.ts');
const warrantCompletionRoute = source('src/pages/api/building-warrant/[id]/certifier-details.ts');
const preparationPage = source('src/pages/planning/[id]/preparation.astro');
const statusPanel = source('src/components/automation/DesktopAutomationStatus.astro');
const liveStatusPanel = source('src/components/automation/DesktopAutomationLiveCard.tsx');
const failureRecovery = source('src/components/automation/AutomationFailureRecovery.tsx');
const launchButton = source('src/components/automation/AutomationLaunchButton.tsx');

assert.match(
  restartRoute,
  /buildFreshAutomationJob\(\{[\s\S]*const \{ jobId: newJobId, snapshot \} = freshJob/,
  'restart creates a distinct job and immutable snapshot through the shared fresh-job path',
);
assert.match(snapshotService, /buildFreshAutomationJob[\s\S]*randomUUID\(\)[\s\S]*buildAutomationJobSnapshot/, 'fresh jobs always receive a new identity and use the canonical snapshot builder');
assert.match(normalCreateRoute, /buildFreshAutomationJob/, 'normal job creation shares the fresh-job builder');
assert.match(projectCreateRoute, /buildFreshAutomationJob/, 'project Run Application preparation shares the fresh-job builder');
assert.match(
  restartRoute,
  /planningApplicationId: oldJob\.type === AutomationJobType\.BUILDING_WARRANT[\s\S]*buildingWarrantApplicationId: oldJob\.type === AutomationJobType\.BUILDING_WARRANT/,
  'retry preserves the exact application identity for Planning and shared Building Warrant snapshots',
);
assert.doesNotMatch(
  restartRoute,
  /oldJob\.(documentSnapshot|resultSummary|lastCheckpoint)|documentIds:/,
  'restart never copies old form values, document selection or execution state',
);
assert.match(
  restartRoute,
  /oldJob\.status !== AutomationJobStatus\.FAILED_RETRYABLE \|\| !recovery\.retrySafe/,
  'only a runner-confirmed safe new attempt can enter the retry path',
);
assert.doesNotMatch(restartRoute, /transaction\.automationJob\.update/, 'retry never mutates the failed historical job');
assert.doesNotMatch(restartRoute, /oldJob\.completedAt|data: \{ completedAt:/, 'retry does not consume or rewrite Job A');
assert.match(callbackRoute, /COMPLETED[\s\S]*FAILED_RETRYABLE[\s\S]*FAILED_FINAL[\s\S]*\? new Date\(\) : null/, 'retryable failures are finalized when their callback is stored');
assert.match(restartRoute, /\$executeRaw\(Prisma\.sql`[\s\S]*pg_advisory_xact_lock[\s\S]*existingActive/, 'concurrent retries execute the transaction lock without deserializing its void result');
assert.match(restartRoute, /existingActive[\s\S]*already has an active automation attempt/, 'a second active run is rejected');
assert.match(
  restartRoute,
  /status: AutomationJobStatus\.READY,[\s\S]*executionAuthorisedAt: authorisedAt/,
  'the replacement is queued and authorised for automatic Agent discovery',
);
assert.match(restartRoute, /organisationId: organisation\.id/, 'retry lookup and mutation remain organisation scoped');
assert.match(restartRoute, /agentSupportsJob[\s\S]*ensureWaitingForAgentAction/, 'retry uses the existing automatic Agent compatibility and waiting flow');
assert.doesNotMatch(restartRoute, /preparationRedirectTo/, 'retry does not send the user back through manual preparation');
assert.doesNotMatch(statusService.match(/reusableAutomationJobStatuses = \[[\s\S]*?\] as const/)?.[0] ?? '', /FAILED/, 'failed jobs are historical and are never reused as normal prepared jobs');
assert.doesNotMatch(prepareRoute.match(/refreshableStatuses = \[[\s\S]*?\]/)?.[0] ?? '', /FAILED/, 'generic prepare cannot rewrite a failed job snapshot');
assert.doesNotMatch(preparationMutation.match(/editableJobStatuses = new Set[\s\S]*?\]\)/)?.[0] ?? '', /FAILED/, 'full preparation editing cannot rewrite a failed job snapshot');
assert.doesNotMatch(completionRoute.match(/refreshableStatuses = \[[\s\S]*?\]/)?.[0] ?? '', /FAILED/, 'Planning corrections save canonical data without rewriting Job A');
assert.doesNotMatch(warrantCompletionRoute.match(/refreshableStatuses = \[[\s\S]*?\]/)?.[0] ?? '', /FAILED/, 'Warrant corrections save canonical data without rewriting Job A');
assert.match(lifecycleService, /FAILED_RETRYABLE: new Set\(\)[\s\S]*FAILED: new Set\(\)/, 'the lifecycle cannot revive any failed historical job');

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
assert.match(failureRecovery, /Retry application/, 'the contextual failure recovery owns the state-driven retry action');
assert.match(liveStatusPanel, /setCurrentJobId\(result\.job\.id\)/, 'the retry state replaces the failed projection live');
assert.match(liveStatusPanel, /setJob\(result\.job\)/, 'the Project card immediately renders the newly queued job');
assert.doesNotMatch(launchButton, /RestartAutomationJobButton|Restart desktop automation/, 'the old generic restart control is removed');

console.log('Planning automation restart lifecycle regression tests passed');
