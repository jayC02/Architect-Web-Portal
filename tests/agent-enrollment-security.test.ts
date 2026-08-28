import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  agentConnectionQuerySchema,
  agentSetupAuthorisationSchema,
  pkceAgentEnrollmentExchangeSchema,
} from '../src/lib/validation/desktop-agent';
import { safeReturnTo } from '../src/lib/auth/return-to';
import { verifyPkceChallenge } from '../src/server/auth/agent-credential';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const installationId = '9c65df19-5a77-4e2c-a82f-30362b36773e';
const verifier = 'v'.repeat(64);
const challenge = crypto.createHash('sha256').update(verifier, 'utf8').digest('base64url');
const state = 's'.repeat(43);

assert.equal(verifyPkceChallenge(verifier, challenge), true);
assert.equal(verifyPkceChallenge(`${verifier}x`, challenge), false);
assert.doesNotThrow(() => agentSetupAuthorisationSchema.parse({ installationId, codeChallenge: challenge, state, port: 49152 }));
assert.doesNotThrow(() => agentConnectionQuerySchema.parse({ installationId, codeChallenge: challenge, state, port: '49152' }));
assert.throws(() => agentSetupAuthorisationSchema.parse({ installationId, codeChallenge: challenge, state, port: 0 }));
assert.throws(() => agentConnectionQuerySchema.parse({ installationId, codeChallenge: challenge, state, port: '65536' }));
assert.throws(() => pkceAgentEnrollmentExchangeSchema.parse({ grant: `ape_${'a'.repeat(48)}`, codeVerifier: 'short', installationId, machineName: 'PC', agentVersion: '4.1.0', capabilities: {} }));
assert.equal(safeReturnTo('/desktop-agent/connect?state=safe'), '/desktop-agent/connect?state=safe');
assert.equal(safeReturnTo('https://example.net/steal'), '/dashboard');

const schema = read('prisma/schema.prisma');
const setupRoute = read('src/pages/api/settings/desktop-agents/setup.ts');
const authoriseRoute = read('src/pages/api/settings/desktop-agents/authorise.ts');
const exchangeRoute = read('src/pages/api/desktop/enrollment/exchange.ts');
const registrationRoute = read('src/pages/api/desktop/registration.ts');
const agentsRoute = read('src/pages/api/settings/desktop-agents/index.ts');
const revokeRoute = read('src/pages/api/settings/desktop-agents/[id].ts');
const browserConnection = read('src/components/integrations/AgentBrowserConnection.tsx');
const setupFlow = read('src/components/integrations/AgentSetupFlow.tsx');
const launcher = read('src/components/automation/AutomationLaunchButton.tsx');

assert.match(schema, /model AgentSetupIntent/);
assert.match(schema, /installationId\s+String\?/);
assert.match(schema, /codeChallenge\s+String\?/);
assert.match(schema, /enrolledByUserId/);
assert.match(setupRoute, /setAgentSetupCookie/);
assert.match(setupRoute, /agentSetupIntent\.create/);
assert.match(authoriseRoute, /agentSetupIntent\.updateMany/);
assert.match(authoriseRoute, /http:\/\/127\.0\.0\.1:\$\{body\.port\}\/callback/);
assert.match(authoriseRoute, /installationId:\s*body\.installationId/);
assert.match(authoriseRoute, /codeChallenge:\s*body\.codeChallenge/);
assert.match(exchangeRoute, /verifyPkceChallenge\(body\.codeVerifier, enrollment\.codeChallenge\)/);
assert.match(exchangeRoute, /usedAt:\s*null, expiresAt:\s*\{ gt: now \}/);
assert.match(exchangeRoute, /already enrolled with another organisation/);
assert.match(exchangeRoute, /agentRegistration\.update/);
assert.match(registrationRoute, /requireAgentAuth/);
assert.match(agentsRoute, /enrolledByUserId:\s*user\.id/);
assert.match(revokeRoute, /enrolledByUserId:\s*user\.id/);
assert.match(browserConnection, /window\.location\.replace\(result\.callbackUrl\)/);
assert.doesNotMatch(browserConnection, /localhost/);
assert.match(setupFlow, /Download & connect Agent/);
assert.match(setupFlow, /secure setup window expired/i);
assert.match(setupFlow, /alreadyConnectedAgents/);
assert.match(setupFlow, /alreadyConnectedAgents\.current\.get\(item\.id\) !== item\.agentVersion/);
assert.doesNotMatch(setupFlow, /paste.*code|copy.*code/i);
assert.match(launcher, /Your queued application will start automatically/);
assert.match(launcher, /<AgentSetupFlow compact/);

console.log('Agent enrollment security tests passed');
