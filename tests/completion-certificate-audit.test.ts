import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HttpError } from '../src/lib/utils/http';
import { automationJobCreateSchema } from '../src/lib/validation/automation-job';
import { currentDashboardJobs } from '../src/lib/dashboard/overview';
import { recordAutomationReadinessTransition } from '../src/server/services/application-lifecycle.service';
import { restartFailedAutomationJobInTransaction } from '../src/server/services/automation-job-restart.service';
import { ensureWaitingForAgentAction } from '../src/server/services/desktop-agent.service';
import { reconcilePreparedApplicationReview } from '../src/server/services/prepared-application-review.service';

const fixture = JSON.parse(readFileSync('tests/fixtures/automation-job-v2-completion-certificate.json', 'utf8'));
const completionJob = {
  id: 'job_12345678', organisationId: 'org', projectId: 'project', type: 'COMPLETION_CERTIFICATE',
  status: 'AWAITING_PORTAL_REVIEW', resultData: null, progressStage: null, lastCheckpoint: null,
  dataSnapshot: { ...fixture, metadata: { ...fixture.metadata, jobId: 'job_12345678', projectId: 'project' } },
};
// Any database access not explicitly allowed is a failure: completion jobs
// must leave warrant, planning, deadline and action-item rows alone.
const untouchable = () => new Proxy({}, {
  get: (_target, property) => {
    throw new Error(`Unexpected database access: ${String(property)}`);
  },
});

// Readiness lifecycle (calendar, deadlines, Xero milestones) is not driven by completion jobs.
assert.equal(await recordAutomationReadinessTransition(untouchable() as never, {
  organisationId: 'org', projectId: 'project', jobType: 'COMPLETION_CERTIFICATE' as never,
  previousStatus: null, nextStatus: 'READY' as never, readinessKey: 'sha256:x',
}), null);

// A finished completion run opens no warrant or planning final-review action.
assert.deepEqual(await reconcilePreparedApplicationReview(untouchable() as never, {
  organisationId: 'org', job: completionJob as never, occurredAt: new Date('2026-11-11T12:00:00.000Z'),
  resultOutcome: 'awaiting_user_portal_review',
}), { outcome: 'not-applicable', applicationId: 'warrant_1' });

// The generic retry rebuilds warrant/planning snapshots, so it refuses completion jobs.
{
  const builds: unknown[] = [];
  const tx = {
    $executeRaw: async () => 0,
    automationJob: { findFirst: async () => completionJob, create: async (args: unknown) => { builds.push(args); } },
    automationJobEvent: { findUnique: async () => null },
  };
  await assert.rejects(
    () => restartFailedAutomationJobInTransaction(tx as never, {
      organisation: { id: 'org', name: 'Fixture Practice' },
      actor: { id: 'user', name: 'Fixture User', email: 'fixture@example.com' },
      oldJobId: completionJob.id,
    }),
    (error) => error instanceof HttpError && error.status === 409 && /completion certificate/i.test(error.message),
  );
  assert.deepEqual(builds, []);
}

// The generic job endpoint cannot create a completion job with the wrong builder.
assert.equal(automationJobCreateSchema.safeParse({ projectId: 'project', type: 'COMPLETION_CERTIFICATE' }).success, false);
assert.equal(automationJobCreateSchema.safeParse({ projectId: 'project', type: 'BUILDING_WARRANT' }).success, true);

// "Waiting for Agent" notices for a completion job link to the warrant card.
{
  let upsert: any;
  await ensureWaitingForAgentAction({ actionItem: { upsert: async (args: unknown) => { upsert = args; } } } as never, {
    id: 'job_12345678', organisationId: 'org', projectId: 'project', type: 'COMPLETION_CERTIFICATE' as never,
  });
  assert.equal(upsert.create.actionUrl, '/projects/project#building-warrant');
}

// On the dashboard a completion job and the warrant's own job are separate current jobs.
{
  const at = new Date('2026-11-11T12:00:00.000Z');
  const jobs = [
    { id: 'completion', type: 'COMPLETION_CERTIFICATE', projectId: 'project', applicationId: 'warrant_1', status: 'READY', createdAt: at },
    { id: 'warrant', type: 'BUILDING_WARRANT', projectId: 'project', applicationId: 'warrant_1', status: 'AWAITING_PORTAL_REVIEW', createdAt: new Date(at.getTime() - 1000) },
    { id: 'planning', type: 'HOUSEHOLDER_PLANNING', projectId: 'project', applicationId: 'planning_1', status: 'READY', createdAt: at },
  ];
  assert.deepEqual(currentDashboardJobs(jobs as never).map((job: { id: string }) => job.id).sort(), ['completion', 'planning', 'warrant']);
}

// Every remaining "warrant, otherwise planning" branch a completion job can reach names the new type.
for (const file of [
  'src/pages/api/automation-jobs/[id]/launch.ts',
  'src/pages/api/automation-jobs/[id]/preparation.ts',
  'src/pages/api/automation-jobs/[id]/prepare.ts',
  'src/pages/api/dashboard/summary.ts',
  'src/pages/automation-job/[id].astro',
  'src/pages/automation-jobs.astro',
  'src/components/automation/AgentQueueDropdown.tsx',
]) {
  assert.match(readFileSync(file, 'utf8'), /COMPLETION_CERTIFICATE/, `${file} handles completion certificate jobs explicitly`);
}

console.log('completion-certificate-audit: ok');
