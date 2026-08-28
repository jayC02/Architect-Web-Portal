import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AutomationJobStatus, AutomationJobType } from '@prisma/client';
import {
  automationJobApplicationId,
  desktopAutomationPresentation,
  resolveAutomationJobIdentity,
  reusableAutomationJobStatuses,
  selectCurrentAutomationJob,
  type DesktopAutomationJob,
} from '../src/server/services/desktop-automation-status.service';

const makeJob = (
  id: string,
  status: AutomationJobStatus,
  applicationId: string,
  updatedAt: string,
  overrides: Partial<DesktopAutomationJob> = {},
): DesktopAutomationJob => ({
  id,
  projectId: 'project-1',
  type: AutomationJobType.BUILDING_WARRANT,
  status,
  dataSnapshot: {
    contractVersion: 'architectpro.automation-job',
    snapshotVersion: 2,
    metadata: {
      jobId: id,
      projectId: 'project-1',
      applicationType: AutomationJobType.BUILDING_WARRANT,
    },
    planning: null,
    buildingWarrant: { recordId: applicationId },
  },
  documentSnapshot: { documents: [] },
  resultSummary: null,
  error: null,
  resultData: null,
  lastCheckpoint: null,
  payloadVersion: 2,
  preparedAt: new Date(updatedAt),
  claimedAt: null,
  executionAuthorisedAt: null,
  agentRunId: null,
  agentHeartbeatAt: null,
  progressStage: null,
  progressStageState: null,
  progressPercent: null,
  etaSeconds: null,
  progressMessage: null,
  progressUpdatedAt: null,
  completedAt: null,
  createdAt: new Date(updatedAt),
  updatedAt: new Date(updatedAt),
  ...overrides,
});

const running = makeJob(
  'running',
  AutomationJobStatus.CLAIMED,
  'warrant-1',
  '2026-07-01T10:00:00.000Z',
  { claimedAt: new Date('2026-07-01T10:05:00.000Z') },
);
const newerReady = makeJob(
  'ready',
  AutomationJobStatus.READY,
  'warrant-1',
  '2026-07-02T10:00:00.000Z',
);
assert.equal(
  selectCurrentAutomationJob([newerReady, running], {
    projectId: 'project-1',
    types: [AutomationJobType.BUILDING_WARRANT],
    applicationId: 'warrant-1',
  })?.id,
  'running',
  'a claimed job is never replaced by another prepared job',
);

const otherApplication = makeJob(
  'other-application',
  AutomationJobStatus.READY,
  'warrant-2',
  '2026-07-03T10:00:00.000Z',
);
assert.equal(
  selectCurrentAutomationJob([otherApplication, newerReady], {
    projectId: 'project-1',
    types: [AutomationJobType.BUILDING_WARRANT],
    applicationId: 'warrant-1',
  })?.id,
  'ready',
  'current-job selection does not merge separate applications in one project',
);

const v1Job = makeJob(
  'legacy',
  AutomationJobStatus.READY,
  'ignored',
  '2026-06-01T10:00:00.000Z',
  { dataSnapshot: { buildingWarrantApplication: { id: 'legacy-warrant' } } },
);
assert.equal(automationJobApplicationId(v1Job), 'legacy-warrant', 'Snapshot V1 application ids remain readable');
assert.equal(automationJobApplicationId(newerReady), 'warrant-1', 'Snapshot V2 application ids remain readable');

const planningJob = makeJob(
  'planning',
  AutomationJobStatus.READY,
  'planning-1',
  '2026-07-04T10:00:00.000Z',
  {
    type: AutomationJobType.PLANNING_APPLICATION,
    dataSnapshot: {
      contractVersion: 'architectpro.automation-job',
      snapshotVersion: 2,
      metadata: {
        jobId: 'planning',
        projectId: 'project-1',
        applicationType: AutomationJobType.PLANNING_APPLICATION,
      },
      planning: { recordId: 'planning-1' },
      buildingWarrant: null,
    },
  },
);
assert.deepEqual(resolveAutomationJobIdentity(planningJob), {
  jobId: 'planning',
  projectId: 'project-1',
  applicationType: AutomationJobType.PLANNING_APPLICATION,
  applicationId: 'planning-1',
  snapshotVersion: 2,
});
assert.throws(
  () => resolveAutomationJobIdentity({
    ...planningJob,
    type: AutomationJobType.BUILDING_WARRANT,
  }),
  /application type do not match/,
  'a conflicting job and Snapshot type is blocked instead of falling back to Building Warrant',
);
assert.throws(
  () => resolveAutomationJobIdentity({
    ...planningJob,
    dataSnapshot: {
      ...(planningJob.dataSnapshot as Record<string, unknown>),
      planning: null,
    },
  }),
  /missing its exact application record/,
  'a V2 Snapshot without the exact application record is blocked',
);

assert.ok(reusableAutomationJobStatuses.includes(AutomationJobStatus.READY));
assert.ok(reusableAutomationJobStatuses.includes(AutomationJobStatus.NEEDS_INPUT));
assert.ok(reusableAutomationJobStatuses.includes(AutomationJobStatus.CLAIMED));
assert.ok(reusableAutomationJobStatuses.includes(AutomationJobStatus.IN_PROGRESS));
assert.ok(!reusableAutomationJobStatuses.includes(AutomationJobStatus.COMPLETED as never));
assert.ok(!reusableAutomationJobStatuses.includes(AutomationJobStatus.CANCELLED as never));

assert.equal(desktopAutomationPresentation(AutomationJobStatus.READY).label, 'Ready to run');
assert.equal(desktopAutomationPresentation(AutomationJobStatus.NEEDS_INPUT).label, 'Needs your attention');
assert.equal(desktopAutomationPresentation(AutomationJobStatus.IN_PROGRESS).label, 'Agent running');
assert.equal(desktopAutomationPresentation(AutomationJobStatus.IN_PROGRESS).actionLabel, 'Resume in desktop');
assert.equal(desktopAutomationPresentation(AutomationJobStatus.COMPLETED).label, 'Application prepared');
assert.equal(desktopAutomationPresentation(AutomationJobStatus.FAILED_FINAL).label, 'Could not complete');
assert.equal(desktopAutomationPresentation(AutomationJobStatus.CANCELLED).label, 'Cancelled');

const appShell = fs.readFileSync('src/components/layout/AppShell.astro', 'utf8');
const settingsPanel = fs.readFileSync('src/components/live/LiveDataPanel.tsx', 'utf8');
const historyPage = fs.readFileSync('src/pages/automation-jobs.astro', 'utf8');
const statusPanel = fs.readFileSync('src/components/automation/DesktopAutomationStatus.astro', 'utf8');
const liveCard = fs.readFileSync('src/components/automation/DesktopAutomationLiveCard.tsx', 'utf8');
const failureRecovery = fs.readFileSync('src/components/automation/AutomationFailureRecovery.tsx', 'utf8');
const statusRoute = fs.readFileSync('src/pages/api/automation-jobs/[id]/status.ts', 'utf8');
const revealRoute = fs.readFileSync('src/pages/api/automation-jobs/[id]/reveal-browser.ts', 'utf8');
const revealAckRoute = fs.readFileSync('src/pages/api/desktop/automation-jobs/[id]/reveal-browser.ts', 'utf8');
const viewRoute = fs.readFileSync('src/pages/api/desktop/automation-jobs/[id]/view.ts', 'utf8');
const heartbeatRoute = fs.readFileSync('src/pages/api/desktop/heartbeat.ts', 'utf8');
const enrollmentPanel = fs.readFileSync('src/components/integrations/DesktopAccessIntegration.tsx', 'utf8');
const enrollmentFlow = fs.readFileSync('src/components/integrations/AgentSetupFlow.tsx', 'utf8');
const projectFees = fs.readFileSync('src/components/projects/ProjectFees.astro', 'utf8');
const projectPage = fs.readFileSync('src/pages/projects/[id].astro', 'utf8');
const launchButton = fs.readFileSync('src/components/automation/AutomationLaunchButton.tsx', 'utf8');
const projectRoute = fs.readFileSync('src/pages/api/projects/[id]/automation-jobs.ts', 'utf8');
const globalRoute = fs.readFileSync('src/pages/api/automation-jobs/index.ts', 'utf8');
const commitRoute = fs.readFileSync('src/pages/api/application-drafts/[id]/commit.ts', 'utf8');
const draftReview = fs.readFileSync('src/components/applications/ApplicationDraftReview.tsx', 'utf8');
const preparationPage = fs.readFileSync('src/pages/automation-job/[id].astro', 'utf8');
const warrantPreparationPage = fs.readFileSync('src/pages/building-warrant/[id]/preparation.astro', 'utf8');
const planningPreparationPage = fs.readFileSync('src/pages/planning/[id]/preparation.astro', 'utf8');
const planningCompletionRoute = fs.readFileSync('src/pages/api/planning/[id]/complete-details.ts', 'utf8');
const legacyWarrantRoute = fs.readFileSync('src/pages/projects/[id]/building-warrant.astro', 'utf8');
const legacyPlanningRoute = fs.readFileSync('src/pages/projects/[id]/planning.astro', 'utf8');
const launchRoute = fs.readFileSync('src/pages/api/automation-jobs/[id]/launch.ts', 'utf8');
const exchangeRoute = fs.readFileSync('src/pages/api/desktop/handoff/exchange.ts', 'utf8');

assert.doesNotMatch(appShell, /AI Automation/, 'primary navigation does not expose the internal job system');
assert.match(appShell, /New application/, 'the AI-first application entry remains in primary navigation');
assert.match(settingsPanel, /href="\/automation-jobs"[\s\S]*Desktop job history/, 'Settings retains a secondary history link');

assert.match(historyPage, /Desktop job history/, 'the support route remains available');
assert.match(historyPage, /organisationId: auth\.organisation\.id/, 'history is organisation scoped');
assert.doesNotMatch(historyPage, /Create desktop job|summaryCards|Show technical JSON/, 'history hides global creation and internal diagnostics');
assert.match(historyPage, /value: 'active'[\s\S]*value: 'attention'[\s\S]*value: 'history'/, 'history defaults to simple filters');
assert.match(historyPage, /attentionStatuses\.includes\(status\)[\s\S]*AutomationJobStatus\.READY/, 'active history prioritises attention before ready and running work');

assert.match(statusPanel, /DesktopAutomationLiveCard client:load/, 'prepared jobs render through the live state-driven application card');
assert.match(statusPanel, /Complete Building Warrant details/, 'Building Warrant needs-input work uses specific wording');
assert.match(statusPanel, /Complete Planning application details/, 'Planning needs-input work uses specific wording');
assert.match(statusPanel, /canPrepare && !preparationReady[\s\S]*AutomationLaunchButton[\s\S]*destination="preparation"/, 'an application without a job creates one before opening focused preparation');
assert.match(launchButton, /destination === 'preparation' \? result\.preparationRedirectTo : result\.redirectTo/, 'the preparation action follows the exact route returned for the created or reused job');
assert.match(liveCard, /setInterval\([\s\S]*3_000/, 'active application state polls the existing projection path without a page refresh');
assert.match(liveCard, /visualCountdownDurationSeconds = 90/, 'the web presentation countdown starts from a ninety-second estimate');
assert.match(liveCard, /About 90 seconds remaining/, 'the visual countdown uses the requested initial copy');
assert.match(liveCard, /executionStartTime\(initial\.executionAuthorisedAt\)/, 'the visual countdown can reuse the existing authorisation timestamp');
assert.match(liveCard, /setInterval\(\(\) => setVisualNow\(Date\.now\(\)\), 1_000\)/, 'the visual countdown ticks locally about once per second');
assert.match(liveCard, /Math\.max\(0, visualCountdownDurationSeconds/, 'the visual countdown never renders negative time');
assert.match(liveCard, /Finishing up…/, 'the visual countdown switches to finishing-up copy after ninety seconds');
assert.match(liveCard, /active && !awaitingFee && !addressAction/, 'paused-for-action states remove the visual countdown');
assert.match(liveCard, /job\.status === 'READY'[\s\S]*Queued/, 'the live card covers authorised and queued state');
assert.match(liveCard, /new Set\(\['CLAIMED', 'IN_PROGRESS'\]\)/, 'the live card covers claimed and running states');
assert.match(liveCard, /AWAITING_PORTAL_REVIEW[\s\S]*Complete the fee in the browser/, 'awaiting-fee has explicit non-failure copy');
assert.match(liveCard, /Continue fee in browser/, 'awaiting-fee exposes the primary browser handoff action');
assert.match(liveCard, /job\.status === 'COMPLETED'[\s\S]*Automation complete/, 'verified preparation renders as a positive completed state');
assert.match(liveCard, /View Householder/, 'Householder completion uses its workflow-specific CTA');
assert.match(liveCard, /View Warrant/, 'Building Warrant completion uses its workflow-specific CTA');
assert.doesNotMatch(liveCard, /Restart desktop automation|Complete Planning application details/, 'fee and running states do not expose competing restart or preparation actions');
assert.match(liveCard, /connectedAgent[\s\S]*Run application/, 'the connected Agent path is the primary ready-state action');
assert.match(liveCard, /failedStatuses[\s\S]*Automation stopped[\s\S]*Stage:/, 'structured failures are prominent and name the stage');
assert.match(failureRecovery, /directRetry[\s\S]*Retry application/, 'positively safe failures expose the primary Retry application action');
assert.match(failureRecovery, /review_portal[\s\S]*Review current portal state/, 'uncertain and final failures expose portal review instead of blind retry');
assert.match(liveCard, /setCurrentJobId\(result\.job\.id\)[\s\S]*setJob\(result\.job\)/, 'retry transitions the open card to the replacement job without a refresh');
assert.match(statusRoute, /organisationId: organisation\.id/, 'live projections remain organisation scoped');
assert.doesNotMatch(statusPanel, /storageKey|password|token/i, 'normal status UI exposes no credentials or storage references');

assert.match(revealRoute, /organisationId: organisation\.id[\s\S]*AutomationJobStatus\.COMPLETED[\s\S]*AutomationJobStatus\.AWAITING_PORTAL_REVIEW[\s\S]*browserRevealRequestedAt/, 'browser open requests are organisation scoped for prepared and legacy fee-paused jobs');
assert.match(revealRoute, /Desktop Agent isn't connected\. Open Architect Pro Agent to view this application\./, 'an offline Agent returns a clear recovery message');
assert.match(heartbeatRoute, /claimedByAgentId: agent\.id[\s\S]*agentRunId: body\.agentRunId[\s\S]*REVEAL_BROWSER/, 'reveal commands preserve the claimed Agent and run identity');
assert.match(heartbeatRoute, /organisationId: agent\.organisationId[\s\S]*claimedByAgentId: agent\.id[\s\S]*status: AutomationJobStatus\.COMPLETED[\s\S]*OPEN_APPLICATION/, 'completed View commands remain scoped to the preparing Agent and original job');
assert.match(revealAckRoute, /browserRevealRequestedAt\.toISOString\(\) !== body\.requestedAt/, 'stale reveal acknowledgements cannot consume a newer command');
assert.match(viewRoute, /organisationId: agent\.organisationId[\s\S]*claimedByAgentId: agent\.id[\s\S]*status: AutomationJobStatus\.COMPLETED/, 'fresh-session job data is Agent-authenticated, organisation scoped, and completed-only');
assert.doesNotMatch(viewRoute, /createProposal|createApplication|prisma\.[a-zA-Z]+\.create/, 'View never creates a proposal, application, or database record');

assert.match(enrollmentPanel, /AgentSetupFlow/, 'Agent settings use the shared automatic enrollment flow');
assert.match(enrollmentFlow, /Download & connect Agent/, 'Agent enrollment offers one clear setup action');
assert.match(enrollmentFlow, /connect automatically/, 'Agent enrollment explains the automatic browser connection');
assert.doesNotMatch(enrollmentFlow, /Paste the code|Copy one-time code/i, 'Agent enrollment never asks users to move a secret manually');
assert.match(enrollmentPanel, /activeAgent[\s\S]*connectedAgent=\{activeAgent\}/, 'connected or offline Agent state is passed into the shared flow');
assert.match(projectFees, /Agreed[\s\S]*Invoiced[\s\S]*Paid[\s\S]*Outstanding[\s\S]*Overdue/, 'fees render the compact finance summary');
assert.match(projectFees, /Ready to invoice[\s\S]*Draft created[\s\S]*Waived[\s\S]*Needs attention/, 'milestones use semantic states');
assert.match(projectFees, /milestone\.state === 'ELIGIBLE'[\s\S]*Create Xero draft/, 'Xero draft creation stays inside the eligible milestone action area');
assert.match(projectFees, /<details class="border-t border-stone-100">[\s\S]*Link an existing Xero invoice/, 'manual invoice linking remains accessible through secondary disclosure');
assert.ok(projectPage.indexOf('<ApplicationSummaryCard') < projectPage.indexOf('<ProjectFees'), 'applications render before fees');
assert.ok(projectPage.indexOf('<ProjectFees') < projectPage.indexOf('id="attention"'), 'next actions and recent activity render below fees');

for (const route of [projectRoute, globalRoute]) {
  assert.match(route, /findReusableAutomationJob/, 'contextual preparation reuses an existing active job');
  assert.match(route, /resolveAutomationApplicationRecord/, 'submitted application ids are revalidated in the active organisation');
}
assert.match(projectRoute, /preparationRedirectTo: preparationRedirectTo\(job\.id\)/, 'new jobs return their exact focused preparation route');
assert.match(projectRoute, /preparationRedirectTo: preparationRedirectTo\(existing\.id\)/, 'reused jobs return their exact focused preparation route');
assert.match(commitRoute, /\/projects\/\$\{encodeURIComponent\(result\.projectId\)\}/, 'AI-first commit returns to the resulting project');
assert.match(commitRoute, /applicationPrepared=1/, 'AI-first commit displays a contextual success state');
assert.doesNotMatch(draftReview, /\/api\/automation-jobs\/\$\{result\.automationJobId\}\/launch/, 'committing never launches desktop automation without another user action');
assert.match(warrantPreparationPage, /automationJobApplicationId\(reusableJob\) === application\.id \? reusableJob : null/, 'focused preparation rejects a job for another application');
assert.match(planningPreparationPage, /automationJobApplicationId\(candidate\) === application\.id/, 'Planning preparation selects only the exact application job');
assert.match(planningPreparationPage, /Planning application details/, 'Planning has a distinct preparation page');
assert.doesNotMatch(planningPreparationPage, /registrationAPart1|registrationBPart1|Certifier details/, 'Planning never renders Building Warrant certifier fields');
assert.match(planningCompletionRoute, /automationJobApplicationId\(job\) !== application\.id/, 'Planning completion rejects the wrong job and application pairing');
assert.match(planningCompletionRoute, /where: \{ id: job\.id \}/, 'Planning completion updates the same job');
assert.doesNotMatch(planningCompletionRoute, /automationJob\.create/, 'Planning completion never creates a replacement job');
assert.match(legacyWarrantRoute, /\/building-warrant\/\$\{application\.id\}\/preparation/, 'legacy tracker links redirect to the focused Building Warrant route');
assert.match(legacyPlanningRoute, /\/planning\/\$\{application\.id\}\/preparation/, 'legacy Planning route redirects to focused preparation');
assert.match(launchRoute, /AutomationJobStatus\.CLAIMED[\s\S]*AutomationJobStatus\.IN_PROGRESS/, 'launch accepts resumable claimed and in-progress states');
assert.match(launchRoute, /claimedByUserId !== user\.id/, 'resume is limited to the user who claimed the job');
assert.match(launchRoute, /claimedByUserId: user\.id/, 'first launch binds the handoff to the user who opened it');
assert.match(exchangeRoute, /job\.status === AutomationJobStatus\.READY \? AutomationJobStatus\.CLAIMED : job\.status/, 'handoff exchange preserves resumable job state');
assert.doesNotMatch(launchRoute, /automationJob\.create/, 'open and resume never create another job');
assert.doesNotMatch(exchangeRoute, /automationJob\.create/, 'handoff exchange never creates another job');

for (const requiredHiddenField of ['projectName', 'siteAddressLine1', 'siteTownCity', 'sitePostcode']) {
  assert.match(
    preparationPage,
    new RegExp(`<input type="hidden" name="${requiredHiddenField}"`),
    `manual preparation preserves hidden required field ${requiredHiddenField}`,
  );
}

console.log('desktop status tests passed');
