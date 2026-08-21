import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DeadlineManagedBy, DeadlineType } from '@prisma/client';
import {
  buildBuildingWarrantGrantedMilestone,
  buildGoogleDeadlineEvent,
  buildPlanningDecisionMilestone,
  decryptGoogleToken,
  encryptGoogleToken,
  googleCalendarMilestoneSyncKey,
  googleManagedEventId,
  isArchitectProManagedCalendarRecord,
  isGoogleCalendarDeadlineEligible,
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
assert.match(event.description, /4 Willow Court/);
assert.equal(event.extendedProperties.private.architectPortalOrganisationId, 'org_1');
assert.deepEqual(event.reminders, {
  useDefault: false,
  overrides: [{ method: 'popup', minutes: 2880 }],
}, 'custom reminders disable defaults and contain one explicit popup override');

const eventWithoutCustomReminder = buildGoogleDeadlineEvent({
  id: 'deadline_2',
  organisationId: 'org_1',
  projectId: null,
  planningApplicationId: null,
  buildingWarrantApplicationId: null,
  title: 'General reminder',
  description: null,
  dueDate: new Date('2026-08-18T00:00:00.000Z'),
  type: 'INTERNAL_TASK',
  status: 'UPCOMING',
  priority: 'MEDIUM',
  reminderDate: null,
  completedDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  project: null,
} as never);
assert.deepEqual(eventWithoutCustomReminder.reminders, {
  useDefault: true,
}, 'default reminders never include custom overrides');

assert.equal(isGoogleCalendarDeadlineEligible({
  managedBy: DeadlineManagedBy.WORKFLOW,
  type: DeadlineType.INTERNAL_TASK,
  sourceKey: 'workflow:planning:planning_1:final-review',
}), false, 'workflow target dates remain internal to Architect Pro');
for (const automationState of ['failed', 'retry', 'prepared']) {
  assert.equal(isGoogleCalendarDeadlineEligible({
    managedBy: DeadlineManagedBy.MANUAL,
    type: DeadlineType.INTERNAL_TASK,
    sourceKey: `automation-job:job_1:${automationState}`,
  }), false, `automation ${automationState} activity never reaches Google Calendar`);
}
assert.equal(isGoogleCalendarDeadlineEligible({
  managedBy: DeadlineManagedBy.GMAIL,
  type: DeadlineType.CUSTOM,
  sourceKey: 'gmail:thread_1:project_1:informationResponse',
}), true, 'a trusted Planning information response date is calendar-worthy');
assert.equal(isGoogleCalendarDeadlineEligible({
  managedBy: DeadlineManagedBy.GMAIL,
  type: DeadlineType.CUSTOM,
  sourceKey: 'gmail:thread_1:project_1:genericUpdate',
}), false, 'generic Gmail activity is not a calendar event');
assert.equal(isGoogleCalendarDeadlineEligible({
  managedBy: DeadlineManagedBy.MANUAL,
  type: DeadlineType.CLIENT_ACTION,
  sourceKey: null,
}), true, 'a deliberately entered dated client commitment remains eligible');
for (const type of [DeadlineType.WARRANT_RESPONSE, DeadlineType.WARRANT_EXPIRY, DeadlineType.COMPLETION_CERTIFICATE]) {
  assert.equal(isGoogleCalendarDeadlineEligible({
    managedBy: DeadlineManagedBy.GMAIL,
    type,
    sourceKey: `gmail:thread_1:project_1:${type}`,
  }), true, `${type} is an explicitly allowed dated commitment`);
}

const informationDueEvent = buildGoogleDeadlineEvent({
  id: 'deadline_information', organisationId: 'org_1', projectId: 'project_1',
  planningApplicationId: 'planning_1', buildingWarrantApplicationId: null,
  title: 'Additional information deadline', description: 'Created from a confirmed project email.',
  dueDate: new Date('2026-09-14T00:00:00.000Z'), type: DeadlineType.CUSTOM,
  status: 'UPCOMING', priority: 'HIGH', reminderDate: null, completedDate: null,
  sourceKey: 'gmail:thread_1:project_1:informationResponse', managedBy: DeadlineManagedBy.GMAIL,
  createdAt: new Date(), updatedAt: new Date(),
  project: { id: 'project_1', name: '55 Kessington Road', siteAddress: '55 Kessington Road, Glasgow', localAuthority: 'Glasgow City Council' },
  planningApplication: { id: 'planning_1', applicationReference: '26/01234/FUL' },
  buildingWarrantApplication: null,
} as never);
assert.equal(informationDueEvent.summary, 'Planning information due — 14 September 2026');
assert.match(informationDueEvent.description, /Glasgow City Council has requested further information/);
assert.match(informationDueEvent.description, /Response due: 14 September 2026/);
assert.match(informationDueEvent.description, /\/projects\/project_1#planning/);

const approval = buildPlanningDecisionMilestone({
  organisationId: 'org_1', planningApplicationId: 'planning_1', projectId: 'project_1',
  projectName: '55 Kessington Road', siteAddress: '55 Kessington Road, Glasgow',
  applicationReference: '26/01234/FUL', decisionDate: new Date('2026-09-14T00:00:00.000Z'), status: 'APPROVED',
});
assert.equal(approval.title, 'Planning approved — Building Warrant ready');
assert.match(approval.description, /Decision: Approved/);
assert.match(approval.description, /26\/01234\/FUL/);
assert.match(approval.actionUrl, /\/projects\/project_1#building-warrant$/);

const refusal = buildPlanningDecisionMilestone({
  organisationId: 'org_1', planningApplicationId: 'planning_1', projectId: 'project_1',
  projectName: '55 Kessington Road', siteAddress: '55 Kessington Road, Glasgow',
  applicationReference: '26/01234/FUL', decisionDate: new Date('2026-09-15T00:00:00.000Z'), status: 'REFUSED',
});
assert.equal(refusal.title, 'Planning refused — review decision');
assert.doesNotMatch(refusal.description, /Building Warrant ready/);
assert.match(refusal.actionUrl, /\/projects\/project_1#planning$/);
assert.equal(approval.syncKey, refusal.syncKey, 'an authoritative outcome change reconciles the same decision event');
assert.equal(googleManagedEventId(approval.syncKey), googleManagedEventId(refusal.syncKey), 'reprocessing cannot create another provider event id');
const approvalWithRevisedDate = buildPlanningDecisionMilestone({
  organisationId: 'org_1', planningApplicationId: 'planning_1', projectId: 'project_1',
  projectName: '55 Kessington Road', siteAddress: '55 Kessington Road, Glasgow',
  applicationReference: '26/01234/FUL', decisionDate: new Date('2026-09-20T00:00:00.000Z'), status: 'APPROVED',
});
assert.equal(approvalWithRevisedDate.syncKey, approval.syncKey, 'updating an authoritative date reconciles the existing milestone');
assert.equal(googleManagedEventId(approvalWithRevisedDate.syncKey), googleManagedEventId(approval.syncKey), 'a revised date retains the same provider event id');

const warrantGranted = buildBuildingWarrantGrantedMilestone({
  organisationId: 'org_1', buildingWarrantApplicationId: 'warrant_1', projectId: 'project_1',
  projectName: '55 Kessington Road', siteAddress: '55 Kessington Road, Glasgow',
  warrantReference: 'BW/2026/0042', grantedDate: new Date('2026-10-08T00:00:00.000Z'),
});
assert.equal(warrantGranted.title, 'Building Warrant granted');
assert.match(warrantGranted.actionUrl, /\/projects\/project_1#building-warrant$/);
assert.equal(warrantGranted.syncKey, googleCalendarMilestoneSyncKey('org_1', 'warrant', 'warrant_1'));

assert.equal(isArchitectProManagedCalendarRecord({
  organisationId: 'org_1', deadlineId: 'deadline_1', syncKey: null,
}, 'org_1'), true, 'a stored deadline link positively identifies an Architect Pro-managed event');
assert.equal(isArchitectProManagedCalendarRecord({
  organisationId: 'org_1', deadlineId: null, syncKey: 'org_1:GOOGLE:planning:planning_1:decision',
}, 'org_1'), true, 'a namespaced sync key positively identifies an Architect Pro-managed milestone');
assert.equal(isArchitectProManagedCalendarRecord({
  organisationId: 'org_1', deadlineId: null, syncKey: null,
}, 'org_1'), false, 'an unowned or unidentifiable event is never eligible for cleanup');

const settingsApi = fs.readFileSync(new URL('../src/pages/api/settings/integrations.ts', import.meta.url), 'utf8');
const connectRoute = fs.readFileSync(new URL('../src/pages/api/integrations/google-calendar/connect.ts', import.meta.url), 'utf8');
const syncRoute = fs.readFileSync(new URL('../src/pages/api/integrations/google-calendar/sync.ts', import.meta.url), 'utf8');
const callbackRoute = fs.readFileSync(new URL('../src/pages/api/integrations/google-calendar/callback.ts', import.meta.url), 'utf8');
const calendarService = fs.readFileSync(new URL('../src/lib/integrations/google-calendar.ts', import.meta.url), 'utf8');
const deadlinesRoute = fs.readFileSync(new URL('../src/pages/api/deadlines/index.ts', import.meta.url), 'utf8');
const deadlineRoute = fs.readFileSync(new URL('../src/pages/api/deadlines/[id].ts', import.meta.url), 'utf8');
assert.doesNotMatch(settingsApi, /accessTokenEncrypted:\s*true|refreshTokenEncrypted:\s*true/, 'integration API never selects encrypted tokens');
assert.match(connectRoute, /requireOrganisationRole\(context, \['OWNER', 'ADMIN'\]\)/, 'only owners and admins can connect Google Calendar');
assert.match(syncRoute, /assertAllowedOrigin\(context\.request\)/, 'manual sync has origin protection');
assert.match(syncRoute, /requireOrganisationRole\(context, \['OWNER', 'ADMIN'\]\)/, 'manual sync is role protected');
assert.match(callbackRoute, /absoluteUrl\('\/settings\/integrations'\)/, 'OAuth callback redirects to the configured public site, not an internal Vercel origin');
assert.doesNotMatch(callbackRoute, /cookies\.get/, 'signed OAuth state does not depend on a fragile cross-redirect nonce cookie');
assert.match(calendarService, /method: 'PUT'/, 'existing Google events are fully replaced so stale reminder overrides cannot survive');
assert.match(calendarService, /sendUpdates=none/, 'managed event reconciliation suppresses invitation and update email notifications');
assert.match(calendarService, /isGoogleCalendarDeadlineEligible\(deadline\)/, 'Google sync is guarded by a strict deadline whitelist');
assert.match(calendarService, /isArchitectProManagedCalendarRecord\(event, organisationId\)/, 'cleanup only touches positively identified Architect Pro records');
assert.match(deadlinesRoute, /syncDeadlineToGoogleBestEffort\(organisation\.id, deadline\.id\)/, 'new deadlines automatically sync to Google Calendar');
assert.match(deadlineRoute, /syncDeadlineToGoogleBestEffort\(organisation\.id, id\)/, 'updated deadlines automatically sync to Google Calendar');
assert.match(deadlineRoute, /removeDeadlineFromGoogleBestEffort\(organisation\.id, id\)/, 'deleted deadlines are automatically removed from Google Calendar');

console.log('google calendar tests passed');
