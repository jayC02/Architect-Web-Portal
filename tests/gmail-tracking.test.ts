import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  extractExplicitDates,
  extractGmailUpdates,
  matchEmailToProjects,
  parseGmailMessage,
  sanitiseEmailHtml,
  type GmailProjectCandidate,
} from '../src/lib/integrations/gmail-tracking';

const encode = (value: string) => Buffer.from(value).toString('base64url');
const parsed = parseGmailMessage({
  id: 'gmail-1',
  threadId: 'thread-1',
  internalDate: String(new Date('2026-08-01T10:00:00Z').getTime()),
  payload: {
    headers: [
      { name: 'From', value: 'Planning Team <planning@glasgow.gov.uk>' },
      { name: 'To', value: 'practice@example.test' },
      { name: 'Subject', value: 'Planning application 26/01234/FUL validated' },
    ],
    parts: [
      { mimeType: 'text/html', body: { data: encode('<style>bad</style><p>Your application is validated.</p><script>alert(1)</script>') } },
      { mimeType: 'application/pdf', filename: 'decision.pdf', body: { attachmentId: 'attachment-1', size: 1234 } },
    ],
  },
});
assert.equal(parsed.sender, 'planning@glasgow.gov.uk');
assert.equal(parsed.subject, 'Planning application 26/01234/FUL validated');
assert.equal(parsed.text, 'Your application is validated.');
assert.equal(parsed.attachments[0]?.gmailAttachmentId, 'attachment-1');
assert.doesNotMatch(sanitiseEmailHtml('<p>Hello</p><iframe src="bad">private</iframe>'), /iframe|private/);

const baseCandidates: GmailProjectCandidate[] = [
  {
    id: 'project-1',
    name: '4 Willow Court',
    internalReference: 'P-1042',
    site: { addressLine1: '4 Willow Court', townCity: 'Glasgow', postcode: 'G12 8AB' },
    client: { email: 'client@example.test' },
    planningApplications: [{ id: 'planning-1', applicationReference: '26/01234/FUL' }],
    warrantApplications: [{ id: 'warrant-1', warrantReference: 'BW/26/9981' }],
    linkedThreadIds: ['confirmed-thread'],
  },
  {
    id: 'project-2',
    name: '8 Willow Court',
    internalReference: 'P-1043',
    site: { addressLine1: '8 Willow Court', townCity: 'Glasgow', postcode: 'G12 8AB' },
    planningApplications: [],
    warrantApplications: [],
  },
];

const exactPlanning = matchEmailToProjects({
  gmailThreadId: 'new-thread',
  sender: 'planning@glasgow.gov.uk',
  subject: '26/01234/FUL validated',
  text: 'The application is valid.',
  excerpt: '',
}, baseCandidates);
assert.equal(exactPlanning.status, 'MATCHED');
assert.equal(exactPlanning.projectId, 'project-1');
assert.equal(exactPlanning.planningApplicationId, 'planning-1');

const exactProject = matchEmailToProjects({
  gmailThreadId: 'new-thread',
  sender: 'consultant@example.test',
  subject: 'Project P-1042',
  text: 'Updated information attached.',
  excerpt: '',
}, baseCandidates);
assert.equal(exactProject.projectId, 'project-1');

const inheritedThread = matchEmailToProjects({
  gmailThreadId: 'confirmed-thread',
  sender: 'unknown@example.test',
  subject: 'Re: update',
  text: 'Please see below.',
  excerpt: '',
}, baseCandidates);
assert.equal(inheritedThread.projectId, 'project-1');
assert.match(inheritedThread.reason, /confirmed Gmail thread/);

const addressMatch = matchEmailToProjects({
  gmailThreadId: 'new-thread',
  sender: 'planning@glasgow.gov.uk',
  subject: 'Application at 4 Willow Court',
  text: 'The application site is 4 Willow Court, G12 8AB.',
  excerpt: '',
}, baseCandidates);
assert.equal(addressMatch.projectId, 'project-1');

const ambiguous = matchEmailToProjects({
  gmailThreadId: 'new-thread',
  sender: 'planning@glasgow.gov.uk',
  subject: 'G12 8AB application',
  text: 'An update for the property in G12 8AB.',
  excerpt: '',
}, baseCandidates);
assert.equal(ambiguous.status, 'AMBIGUOUS', 'shared weak address context requires review');

assert.equal(extractExplicitDates('Please respond by 14 August 2026.')[0]?.iso, '2026-08-14T12:00:00.000Z');
const updates = extractGmailUpdates({
  sender: 'planning@glasgow.gov.uk',
  subject: 'Planning application validated',
  text: 'Application reference: 26/01234/FUL. Your application is validated. Decision target date: 14 August 2026.',
  sentAt: new Date('2026-07-10T09:00:00Z'),
});
assert.ok(updates.some((update) => update.fieldName === 'applicationReference' && update.value === '26/01234/FUL'));
assert.ok(updates.some((update) => update.fieldName === 'status' && update.value === 'VALIDATED'));
assert.ok(updates.some((update) => update.fieldName === 'decisionTargetDate' && update.value === '2026-08-14T12:00:00.000Z'));
assert.ok(updates.some((update) => update.updateType === 'DEADLINE' && update.deadline?.type === 'PLANNING_DECISION'));

const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
const syncRoute = fs.readFileSync('src/pages/api/integrations/gmail/sync.ts', 'utf8');
const linkRoute = fs.readFileSync('src/pages/api/gmail/emails/[id].ts', 'utf8');
const suggestionRoute = fs.readFileSync('src/pages/api/gmail/suggestions/[id].ts', 'utf8');
const cronRoute = fs.readFileSync('src/pages/api/cron/gmail-sync.ts', 'utf8');
const settingsApi = fs.readFileSync('src/pages/api/settings/integrations.ts', 'utf8');
assert.match(schema, /@@unique\(\[organisationId, gmailMessageId\]\)/, 'messages are unique within an organisation');
assert.match(schema, /@@unique\(\[trackedEmailId, gmailAttachmentId\]\)/, 'attachments cannot be imported twice by Gmail id');
assert.match(schema, /@@unique\(\[organisationId, sourceKey\]\)/, 'email-derived deadlines have a stable organisation-scoped key');
assert.match(syncRoute, /assertAllowedOrigin\(context\.request\)/, 'manual Gmail sync has origin protection');
assert.match(syncRoute, /requireOrganisationRole\(context, \['OWNER', 'ADMIN'\]\)/, 'manual Gmail sync is admin protected');
assert.match(linkRoute, /organisationId: organisation\.id/, 'email linking remains organisation scoped');
assert.match(suggestionRoute, /organisationId: organisation\.id/, 'suggestion actions remain organisation scoped');
assert.match(cronRoute, /timingSafeEqual/, 'scheduled sync authenticates its server-side secret in constant time');
assert.doesNotMatch(settingsApi, /accessTokenEncrypted:\s*true|refreshTokenEncrypted:\s*true/, 'Gmail settings never expose Google tokens');

console.log('gmail tracking tests passed');
