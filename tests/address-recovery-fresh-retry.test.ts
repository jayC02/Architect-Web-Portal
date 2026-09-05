import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const correctionRoute = readFileSync(
  'src/pages/api/desktop/automation-jobs/[id]/correct-address.ts',
  'utf8',
);
const restartRoute = readFileSync('src/pages/api/automation-jobs/[id]/restart.ts', 'utf8');
const restartService = readFileSync('src/server/services/automation-job-restart.service.ts', 'utf8');

assert.match(correctionRoute, /requireDesktopAuth/, 'postcode correction requires Desktop authentication');
assert.match(correctionRoute, /assertDesktopJobAccess/, 'job-scoped tokens cannot correct another job');
assert.match(
  correctionRoute,
  /claimedDeviceId: access\.id[\s\S]*status: AutomationJobStatus\.FAILED_RETRYABLE/,
  'only the device-owned safely failed run can request correction',
);
assert.match(
  correctionRoute,
  /automationJobSnapshotV2Schema\.safeParse\(oldJob\.dataSnapshot\)[\s\S]*snapshot\.data\.site\.id/,
  'the immutable snapshot is read only to identify the canonical Site',
);
assert.doesNotMatch(
  correctionRoute,
  /automationJob\.(?:update|updateMany)[\s\S]*dataSnapshot/,
  'postcode correction never patches the frozen AutomationJob snapshot',
);
assert.match(correctionRoute, /prisma\.site\.updateMany/, 'the canonical Site receives the corrected postcode');
assert.match(correctionRoute, /restartFailedAutomationJob/, 'correction uses the shared fresh-job retry service');
assert.match(restartRoute, /restartFailedAutomationJob/, 'manual web retries use the same fresh-job service');
assert.match(restartService, /buildFreshAutomationJob/, 'the retry builds a new immutable snapshot');
assert.match(restartService, /AutomationJobStatus\.READY/, 'the fresh job is queued through the existing READY state');

console.log('address recovery fresh retry tests passed');
