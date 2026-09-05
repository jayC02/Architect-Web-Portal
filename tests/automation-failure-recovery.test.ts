import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readAutomationFailureMetadata } from '../src/lib/automation/failure-recovery';

const source = (path: string) => fs.readFileSync(path, 'utf8');
const liveCard = source('src/components/automation/DesktopAutomationLiveCard.tsx');
const recovery = source('src/components/automation/AutomationFailureRecovery.tsx');
const restart = source('src/pages/api/automation-jobs/[id]/restart.ts');
const restartService = source('src/server/services/automation-job-restart.service.ts');
const restartImplementation = `${restart}\n${restartService}`;
const statusRoute = source('src/pages/api/automation-jobs/[id]/status.ts');
const callbackRoute = source('src/pages/api/desktop/automation-jobs/[id]/index.ts');
const typeOfWorkRoute = source('src/pages/api/building-warrant/[id]/type-of-work.ts');
const domainValidation = source('src/lib/validation/domain.ts');
const projectPage = source('src/pages/projects/[id].astro');
const sharedEditors = source('src/components/live/DirectoryEditor.tsx');

const safe = readAutomationFailureMetadata({
  outcome: 'failed_retryable',
  retrySafe: true,
  safeRetryPoint: 'browser',
  recoveryAction: 'retry',
}, 'FAILED_RETRYABLE', 'browser');
assert.equal(safe.retrySafe, true);
assert.equal(safe.recoveryAction, 'retry');

const uncertain = readAutomationFailureMetadata({
  outcome: 'failed_final',
  retrySafe: false,
  recoveryAction: 'review_portal',
}, 'FAILED_FINAL', 'declaration');
assert.equal(uncertain.retrySafe, false);
assert.equal(uncertain.recoveryAction, 'review_portal');

const contradictoryAddress = readAutomationFailureMetadata({
  outcome: 'failed_retryable',
  safeRetryPoint: 'address_selection',
  errorCode: 'ADDRESS_RESOLUTION_FAILED',
  currentSection: 'login',
}, 'FAILED_RETRYABLE', 'login');
assert.equal(contradictoryAddress.stage, 'address_selection', 'controlled category wins over a stale contradictory stage');
assert.equal(contradictoryAddress.headline, 'Property address could not be resolved');
assert.equal(contradictoryAddress.recoveryAction, 'review_address');

assert.match(liveCard, /readAutomationFailureMetadata\(job\.resultData/, 'failure card reads structured callback metadata');
assert.match(liveCard, /AutomationFailureRecovery/, 'failure card delegates to shared contextual recovery');
assert.doesNotMatch(liveCard, />Review issue<\/a>/, 'failure recovery no longer navigates generically to preparation');
assert.match(recovery, /Review address[\s\S]*SiteForm[\s\S]*compact[\s\S]*Save and retry application/, 'address recovery reuses the compact Site editor');
assert.match(recovery, /Review applicant[\s\S]*ClientForm[\s\S]*compactApplicant/, 'applicant recovery reuses the compact Client editor');
assert.match(recovery, /AgentDefaultsForm[\s\S]*Save and retry application/, 'agent recovery reuses the shared defaults editor');
assert.match(recovery, /architectpro:\/\/settings\/login/, 'login recovery opens the secure Desktop Agent credential flow');
assert.match(recovery, /documentsHref[\s\S]*Review documents/, 'document recovery targets the Project Documents section');
assert.match(recovery, /review_portal[\s\S]*View Warrant[\s\S]*View Householder/, 'uncertain outcomes expose workflow-specific portal review, not retry');
assert.match(recovery, /portal:mutation-success[\s\S]*onRetry\(\)[\s\S]*setEditor\(null\)/, 'successful canonical save queues retry and closes recovery');

assert.match(restartImplementation, /readAutomationFailureMetadata[\s\S]*!recovery\.retrySafe/, 'restart requires positive new-run safety metadata');
assert.match(restartImplementation, /\$executeRaw\(Prisma\.sql`[\s\S]*pg_advisory_xact_lock[\s\S]*existingActive[\s\S]*already has an active automation attempt/, 'restart serializes and blocks duplicate active attempts without deserializing the void lock result');
assert.match(restartImplementation, /buildFreshAutomationJob[\s\S]*const \{ jobId: newJobId, snapshot \}/, 'retry creates a fresh snapshot for a distinct job');
assert.doesNotMatch(restartImplementation, /transaction\.automationJob\.update/, 'failed history remains untouched during retry');
assert.match(restartImplementation, /executionAuthorisedAt: authorisedAt/, 'fresh retry is authorised for automatic Agent claim');
assert.match(statusRoute, /resultData: true, lastCheckpoint: true/, 'live polling returns structured recovery metadata');
assert.match(callbackRoute, /resultData: body\.result/, 'callback projection stores the structured result');

assert.match(typeOfWorkRoute, /requireOrganisation[\s\S]*organisationId: organisation\.id/, 'Type of Work correction is organisation scoped');
assert.match(typeOfWorkRoute, /typeOfWorkKeysSchema[\s\S]*presetKey: body\.typeOfWorkKeys\[0\]/, 'focused correction uses canonical options and storage');
assert.match(domainValidation, /Select at least one type of work\./, 'raw array validation is replaced with product copy');
assert.match(projectPage, /normaliseTypeOfWorkKeys[\s\S]*warrantRecoveryContext|warrantTypeOfWorkKeys/, 'existing saved and legacy Type of Work values hydrate into recovery');
assert.match(projectPage, /documentsHref: `\/projects\/\$\{project\.id\}#documents`/, 'document recovery remains on the current Project page');
assert.match(sharedEditors, /AgentDefaultsForm/, 'Agent defaults are shared between Settings and recovery');

console.log('automation failure recovery tests passed');
