import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decryptGoogleToken, encryptGoogleToken } from '../src/lib/integrations/google-calendar';
import { XERO_SCOPES } from '../src/lib/xero/config';

const read = (file: string) => fs.readFileSync(path.resolve(file), 'utf8');
assert.deepEqual(XERO_SCOPES, [
  'offline_access',
  'accounting.contacts.read',
  'accounting.invoices.read',
  'accounting.payments.read',
  'accounting.reports.profitandloss.read',
  'accounting.reports.aged.read',
  'accounting.settings.read',
]);
assert.equal(XERO_SCOPES.some((scope) => !scope.endsWith('.read') && scope !== 'offline_access'), false, 'no Xero write scope is requested');

const key = Buffer.alloc(32, 12);
const encrypted = encryptGoogleToken('xero-refresh-token', key);
assert.notEqual(encrypted, 'xero-refresh-token');
assert.equal(decryptGoogleToken(encrypted, key), 'xero-refresh-token');
assert.throws(() => decryptGoogleToken(encrypted, Buffer.alloc(32, 13)));

const oauth = read('src/lib/xero/oauth.ts');
const token = read('src/lib/xero/token.ts');
const sync = read('src/lib/xero/sync.ts');
const settingsApi = read('src/pages/api/settings/integrations.ts');
const financePage = read('src/pages/finance.astro');
const clientFinance = read('src/pages/api/finance/clients/[id].ts');
const projectFinance = read('src/pages/api/finance/projects/[id]/invoices.ts');
const connectRoute = read('src/pages/api/integrations/xero/connect.ts');
const callbackRoute = read('src/pages/api/integrations/xero/callback.ts');
const syncRoute = read('src/pages/api/integrations/xero/sync.ts');

assert.match(oauth, /stateHash: hashOpaqueValue\(state\)/, 'raw OAuth state is never stored');
assert.match(oauth, /consumedAt: null, expiresAt: \{ gt: now \}/, 'OAuth state is expiring and one-use');
assert.match(oauth, /attempt\.organisationId !== organisationId \|\| attempt\.userId !== userId/, 'state is bound to the current user and organisation');
assert.match(callbackRoute, /tenants\.length > 1/, 'multiple Xero tenants require an explicit selection step');
assert.match(token, /tokens\.refresh_token/, 'the rotated refresh token is persisted');
assert.match(token, /refreshTokenEncrypted: connection\.refreshTokenEncrypted/, 'refresh persistence uses optimistic concurrency');
assert.match(token, /refreshLocks/, 'same-process concurrent refreshes are serialized');
assert.doesNotMatch(settingsApi, /accessTokenEncrypted:\s*true|refreshTokenEncrypted:\s*true/, 'settings never serializes token fields');
assert.doesNotMatch(settingsApi, /xero.*membership\.role.*MEMBER/s, 'member responses do not include a Xero connection');
assert.match(connectRoute, /requireOrganisationRole\(context, \['OWNER', 'ADMIN'\]\)/);
assert.match(syncRoute, /assertAllowedOrigin\(context\.request\)/);
assert.match(syncRoute, /requireOrganisationRole\(context, \['OWNER', 'ADMIN'\]\)/);
assert.match(financePage, /if \(!\['OWNER', 'ADMIN'\]\.includes\(auth\.membership\.role\)\)/, 'MEMBER cannot access the Finance page');
assert.match(clientFinance, /organisationId: organisation\.id/, 'client finance queries are organisation scoped');
assert.match(projectFinance, /organisationId: organisation\.id/, 'project invoice links are organisation scoped');
assert.match(sync, /\.upsert\(/, 'repeated syncs update by provider identity rather than duplicating rows');
assert.match(sync, /lastSyncedAt: errors\.length \? connection\.lastSyncedAt/, 'partial failures preserve the previous successful-sync marker');
assert.doesNotMatch(sync, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/, 'sync has no Xero write operations');

console.log('xero security tests passed');
