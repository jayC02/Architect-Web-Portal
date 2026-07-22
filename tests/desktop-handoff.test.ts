import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const createRoute = read('../src/pages/api/projects/[id]/automation-jobs.ts');
const claimRoute = read('../src/pages/api/desktop/automation-jobs/[id]/claim.ts');
const documentRoute = read('../src/pages/api/desktop/documents/[id].ts');
const launcher = read('../src/components/automation/AutomationLaunchButton.tsx');
const tokenAuth = read('../src/server/auth/desktop-token.ts');

assert.match(createRoute, /requireProjectAccess\(organisation\.id, projectId\)/, 'job creation must verify project access');
assert.match(createRoute, /status:\s*AutomationJobStatus\.READY/, 'one-click jobs must be ready for desktop');
assert.match(claimRoute, /claimedDeviceId:\s*access\.id/, 'claims must bind the job to the authenticated desktop token');
assert.match(claimRoute, /already open on another desktop device/, 'duplicate claims must be rejected clearly');
assert.match(documentRoute, /organisationId:\s*access\.organisationId/, 'document downloads must be organisation scoped');
assert.match(documentRoute, /documentSnapshot/, 'downloads must be restricted to documents frozen into the job');
assert.doesNotMatch(launcher, /token|password|storageKey/i, 'custom protocol launch must not include secrets');
assert.match(launcher, /architectpro:\/\/automation\//, 'launcher must use the registered ArchitectPro protocol');
assert.match(tokenAuth, /createHash\('sha256'\)/, 'desktop access tokens must be stored as hashes');

console.log('desktop handoff security tests passed');
