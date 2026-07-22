import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildGoogleDeadlineEvent,
  decryptGoogleToken,
  encryptGoogleToken,
  signGoogleOAuthState,
  verifyGoogleOAuthState,
} from '../src/lib/integrations/google-calendar';

const encryptionKey = Buffer.alloc(32, 7);
const encrypted = encryptGoogleToken('private-refresh-token', encryptionKey);
assert.notEqual(encrypted, 'private-refresh-token', 'tokens are encrypted before storage');
assert.equal(decryptGoogleToken(encrypted, encryptionKey), 'private-refresh-token', 'encrypted tokens can be decrypted with the server key');
assert.throws(() => decryptGoogleToken(encrypted, Buffer.alloc(32, 8)), 'a different key cannot decrypt stored tokens');

const stateSecret = 'test-state-secret-that-is-long-enough';
const state = signGoogleOAuthState({
  organisationId: 'org_1',
  userId: 'user_1',
  nonce: 'nonce_1',
  expiresAt: Date.now() + 60_000,
}, stateSecret);
assert.equal(verifyGoogleOAuthState(state, stateSecret).organisationId, 'org_1', 'signed OAuth state round trips');
assert.throws(() => verifyGoogleOAuthState(`${state}tampered`, stateSecret), 'tampered OAuth state is rejected');

const event = buildGoogleDeadlineEvent({
  id: 'deadline_1',
  organisationId: 'org_1',
  projectId: 'project_1',
  planningApplicationId: null,
  buildingWarrantApplicationId: null,
  title: 'Submit planning response',
  description: 'Send revised drawings.',
  dueDate: new Date('2026-08-12T00:00:00.000Z'),
  type: 'PLANNING_DECISION',
  status: 'UPCOMING',
  priority: 'HIGH',
  reminderDate: new Date('2026-08-10T00:00:00.000Z'),
  completedDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  project: { id: 'project_1', name: '4 Willow Court', siteAddress: '4 Willow Court, Glasgow' },
} as never);
assert.equal(event.start.date, '2026-08-12');
assert.equal(event.end.date, '2026-08-13', 'all-day Google events use an exclusive next-day end');
assert.match(event.summary, /4 Willow Court/);
assert.equal(event.extendedProperties.private.architectPortalOrganisationId, 'org_1');

const settingsApi = fs.readFileSync(new URL('../src/pages/api/settings/integrations.ts', import.meta.url), 'utf8');
const connectRoute = fs.readFileSync(new URL('../src/pages/api/integrations/google-calendar/connect.ts', import.meta.url), 'utf8');
const syncRoute = fs.readFileSync(new URL('../src/pages/api/integrations/google-calendar/sync.ts', import.meta.url), 'utf8');
assert.doesNotMatch(settingsApi, /accessTokenEncrypted:\s*true|refreshTokenEncrypted:\s*true/, 'integration API never selects encrypted tokens');
assert.match(connectRoute, /requireOrganisationRole\(context, \['OWNER', 'ADMIN'\]\)/, 'only owners and admins can connect Google Calendar');
assert.match(syncRoute, /assertAllowedOrigin\(context\.request\)/, 'manual sync has origin protection');
assert.match(syncRoute, /requireOrganisationRole\(context, \['OWNER', 'ADMIN'\]\)/, 'manual sync is role protected');

console.log('google calendar tests passed');
