import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AutomationJobType } from '@prisma/client';
import { desktopProgressSchema } from '../src/lib/validation/desktop-agent';
import { agentSupportsJob } from '../src/server/services/desktop-agent.service';

const capabilities = {
  workflows: [AutomationJobType.BUILDING_WARRANT],
  snapshotVersions: [2],
  callbackContractVersions: [1],
  progressContractVersions: [1],
};
assert.equal(agentSupportsJob({ capabilities } as never, { type: AutomationJobType.BUILDING_WARRANT, payloadVersion: 2 }), true);
assert.equal(agentSupportsJob({ capabilities } as never, { type: AutomationJobType.HOUSEHOLDER_PLANNING, payloadVersion: 2 }), false);
assert.equal(agentSupportsJob({ capabilities: { ...capabilities, progressContractVersions: [2] } } as never, { type: AutomationJobType.BUILDING_WARRANT, payloadVersion: 2 }), false);

const validProgress = {
  version: 1,
  jobId: 'job_12345678',
  agentRunId: 'a8192a95-c027-4a4c-9958-33c1da061cb9',
  sequence: 4,
  occurredAt: '2026-08-19T12:00:00.000Z',
  status: 'RUNNING',
  progress: { stage: 'browser', stageState: 'running', percent: 42, etaSeconds: 90, message: 'Entering details' },
};
assert.equal(desktopProgressSchema.safeParse(validProgress).success, true);
assert.equal(desktopProgressSchema.safeParse({ ...validProgress, version: 2 }).success, false);
assert.equal(desktopProgressSchema.safeParse({ ...validProgress, progress: { ...validProgress.progress, percent: 101 } }).success, false);

const claim = fs.readFileSync('src/pages/api/desktop/queue/[id]/claim.ts', 'utf8');
const progress = fs.readFileSync('src/pages/api/desktop/automation-jobs/[id]/progress.ts', 'utf8');
const run = fs.readFileSync('src/pages/api/automation-jobs/[id]/run.ts', 'utf8');
const runService = fs.readFileSync('src/server/services/automation-job-run.service.ts', 'utf8');
const credential = fs.readFileSync('src/server/auth/agent-credential.ts', 'utf8');
const agentService = fs.readFileSync('src/server/services/desktop-agent.service.ts', 'utf8');
assert.match(claim, /automationJob\.updateMany/, 'queue claims use a compare-and-set update');
assert.match(claim, /executionAuthorisedAt: \{ not: null \}/, 'an explicit portal run action is required');
assert.match(claim, /status: AutomationJobStatus\.READY/, 'only ready work is claimable');
assert.match(claim, /agentRunId/, 'a unique run identity is bound during claim');
assert.match(progress, /lastProgressSequence: \{ lt: body\.sequence \}/, 'out-of-order progress cannot replace a newer projection');
assert.match(agentService, /stage === 'address_selection'/, 'address selection remains a first-class user action state');
assert.match(run, /authoriseAutomationJobRun/, 'the run endpoint uses the shared authorisation path');
assert.match(runService, /ensureWaitingForAgentAction/, 'offline execution creates a durable action');
assert.match(credential, /createHash\('sha256'\)/, 'durable Agent credentials are stored as hashes in the portal');
assert.doesNotMatch(credential, /credential:\s*rawCredential/, 'raw durable Agent credentials are not persisted');

console.log('phase 4 background agent tests passed');
