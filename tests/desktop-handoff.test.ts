import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const createRoute = read('../src/pages/api/projects/[id]/automation-jobs.ts');
const claimRoute = read('../src/pages/api/desktop/automation-jobs/[id]/claim.ts');
const documentRoute = read('../src/pages/api/desktop/documents/[id].ts');
const launcher = read('../src/components/automation/AutomationLaunchButton.tsx');
const tokenAuth = read('../src/server/auth/desktop-token.ts');
const exchangeRoute = read('../src/pages/api/desktop/handoff/exchange.ts');
const relaunchRoute = read('../src/pages/api/automation-jobs/[id]/launch.ts');
const desktopIntegration = read('../src/components/integrations/DesktopAccessIntegration.tsx');

assert.match(createRoute, /requireProjectAccess\(organisation\.id, projectId\)/, 'job creation must verify project access');
assert.match(createRoute, /status:\s*AutomationJobStatus\.READY/, 'one-click jobs must be ready for desktop');
assert.match(claimRoute, /claimedDeviceId:\s*access\.id/, 'claims must bind the job to the authenticated desktop token');
assert.match(claimRoute, /already open on another desktop device/, 'duplicate claims must be rejected clearly');
assert.match(documentRoute, /organisationId:\s*access\.organisationId/, 'document downloads must be organisation scoped');
assert.match(documentRoute, /documentSnapshot/, 'downloads must be restricted to documents frozen into the job');
assert.doesNotMatch(launcher, /password|storageKey/i, 'custom protocol launch must not include portal passwords or storage keys');
assert.match(createRoute, /buildDesktopLaunchUrl/, 'new jobs must receive a short-lived desktop launch URL');
assert.match(relaunchRoute, /requireOrganisation\(context\)/, 'relaunching an existing job requires an organisation session');
assert.match(relaunchRoute, /organisationId:\s*organisation\.id/, 'existing job relaunch is organisation scoped');
assert.match(exchangeRoute, /handoffRedeemedAt:\s*null/, 'handoff exchange only accepts unused links');
assert.match(exchangeRoute, /handoffExpiresAt:\s*\{ gt: now \}/, 'handoff exchange rejects expired links');
assert.match(exchangeRoute, /automationJobId:\s*job\.id/, 'automatic desktop credentials are scoped to one job');
assert.match(exchangeRoute, /handoffCodeHash:\s*null/, 'redeemed handoff codes are invalidated immediately');
assert.match(tokenAuth, /assertDesktopJobAccess/, 'desktop API access can be restricted to the selected job');
assert.match(tokenAuth, /createHash\('sha256'\)/, 'desktop access tokens must be stored as hashes');
assert.doesNotMatch(desktopIntegration, /Copy this connection token|Connect device|clipboard/, 'settings must not ask users to copy connection codes');
assert.match(desktopIntegration, /No codes, passwords or device connection setup required/, 'settings explains automatic handoff');

console.log('desktop handoff security tests passed');
