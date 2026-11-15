import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as enums from '@prisma/client';
import { readAutomationFailureMetadata } from '../src/lib/automation/failure-recovery';
import { automationJobSnapshotV2Schema } from '../src/lib/validation/automation-job';
import { agentCapabilitiesSchema } from '../src/lib/validation/desktop-agent';
import { agentSupportsJob } from '../src/server/services/desktop-agent.service';

// A run that stopped after its proposal was created can be resumed: the Agent
// reopens that proposal instead of creating another (the portal refuses duplicates).
const stoppedIn = (currentSection: string, status = 'FAILED_FINAL') => readAutomationFailureMetadata({
  outcome: status === 'FAILED_FINAL' ? 'failed_final' : 'failed_retryable',
  retrySafe: status !== 'FAILED_FINAL',
  recoveryAction: 'review_portal',
  currentSection,
}, status, currentSection);

for (const stage of ['proposal', 'main_details', 'ownership', 'documents', 'declaration', 'final_review']) {
  assert.equal(stoppedIn(stage).resumable, true, `a run that stopped in ${stage} can resume its proposal`);
}
assert.equal(stoppedIn('documents', 'FAILED_RETRYABLE').resumable, true);
for (const stage of ['login', 'browser_startup', 'snapshot_validation']) {
  assert.equal(stoppedIn(stage).resumable, false, `a run that stopped in ${stage} has no proposal of its own to resume`);
}
assert.equal(readAutomationFailureMetadata({ currentSection: 'main_details' }, 'COMPLETED', 'main_details').resumable, false);

// The new run names the failed one, so the Agent can find the proposal it made.
const warrantFixture = JSON.parse(readFileSync('tests/fixtures/automation-job-v2-building-warrant.json', 'utf8'));
const resumeSnapshot = { ...warrantFixture, metadata: { ...warrantFixture.metadata, resumeOfJobId: 'job-failed' } };
assert.equal(automationJobSnapshotV2Schema.parse(resumeSnapshot).metadata.resumeOfJobId, 'job-failed');

// Only Agents that understand resume runs receive them.
const caps = { workflows: ['BUILDING_WARRANT'], snapshotVersions: [2], callbackContractVersions: [1], progressContractVersions: [1] };
const resumeJob = { type: enums.AutomationJobType.BUILDING_WARRANT, payloadVersion: 2, dataSnapshot: { metadata: { resumeOfJobId: 'job-failed' } } };
assert.equal(agentSupportsJob({ capabilities: caps } as never, resumeJob), false, 'an older Agent would create a duplicate proposal');
assert.equal(agentSupportsJob({ capabilities: { ...caps, resumeContractVersions: [1] } } as never, resumeJob), true);
assert.equal(agentCapabilitiesSchema.safeParse({ ...caps, resumeContractVersions: [1] }).success, true);

const restartService = readFileSync('src/server/services/automation-job-restart.service.ts', 'utf8');
const jobsService = readFileSync('src/server/services/automation-jobs.service.ts', 'utf8');
const recovery = readFileSync('src/components/automation/AutomationFailureRecovery.tsx', 'utf8');
assert.match(restartService, /!recovery\.retrySafe && !recovery\.resumable/, 'a resumable run may be restarted even when a fresh start is not safe');
assert.match(restartService, /resumeOfJobId: recovery\.resumable \? oldJob\.id : undefined/, 'the new run resumes the failed one');
assert.match(jobsService, /resumeOfJobId: input\.resumeOfJobId/, 'the snapshot carries the failed run');
assert.match(recovery, /metadata\.resumable && !metadata\.retrySafe[\s\S]*Resume application/, 'a Resume application button appears when a plain retry is not offered');

console.log('automation resume tests passed');
