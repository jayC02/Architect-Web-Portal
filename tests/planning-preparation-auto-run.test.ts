import assert from 'node:assert/strict';
import fs from 'node:fs';

const preparationPage = fs.readFileSync('src/pages/planning/[id]/preparation.astro', 'utf8');
const completionRoute = fs.readFileSync('src/pages/api/planning/[id]/complete-details.ts', 'utf8');
const runRoute = fs.readFileSync('src/pages/api/automation-jobs/[id]/run.ts', 'utf8');
const runService = fs.readFileSync('src/server/services/automation-job-run.service.ts', 'utf8');

assert.match(
  preparationPage,
  />Save and run application<\/button>/,
  'the final Planning action makes it clear that it starts the application automation',
);
assert.match(
  preparationPage,
  /<form[^>]*data-pending-message="Saving and starting automation\.\.\."/,
  'the final action exposes an accurate pending state',
);
assert.match(
  completionRoute,
  /status === AutomationJobStatus\.READY[\s\S]*authoriseAutomationJobRun\(\{ organisationId: organisation\.id, jobId: job\.id \}\)/,
  'a successfully prepared Planning job is authorised from the final form submission',
);
assert.match(
  completionRoute,
  /runResult \? \{ queued: true, \.\.\.runResult \} : \{\}/,
  'the completion response reports that the ready application was queued',
);
assert.match(
  runRoute,
  /authoriseAutomationJobRun/,
  'the project Run action uses the same authorisation service as final Planning checks',
);
assert.match(runService, /status: AutomationJobStatus\.READY/, 'only ready jobs can be authorised');
assert.match(runService, /ensureWaitingForAgentAction/, 'an offline or incompatible Agent still creates durable waiting work');

console.log('planning preparation auto-run test passed');
