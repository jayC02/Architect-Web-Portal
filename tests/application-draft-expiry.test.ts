import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file: string) => fs.readFileSync(file, 'utf8');
const newApplication = read('src/pages/applications/new.astro');
const service = read('src/server/services/application-draft-files.service.ts');
const cron = read('src/pages/api/cron/application-draft-cleanup.ts');
const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> };

// Expired drafts never show in "Continue an application", even before cleanup runs.
assert.match(newApplication, /expiresAt: \{ gt: new Date\(\) \}/, 'the drafts list hides expired drafts');

// Each draft can be removed from the list through the existing cancel endpoint.
assert.match(newApplication, /data-remove-draft=\{draft\.id\}/, 'each draft row has a remove button');
assert.match(newApplication, /draft\.status !== ApplicationDraftStatus\.COMMITTING/, 'a draft being created cannot be removed');
assert.match(newApplication, /method: 'DELETE'/, 'removal uses the cancel endpoint');
assert.match(newApplication, /window\.confirm\(/, 'removal asks for confirmation');
assert.doesNotMatch(
  newApplication,
  /<a href=\{`\/applications\/\$\{draft\.id\}`\}[^>]*>[\s\S]*?<button[\s\S]*?<\/a>/,
  'the remove button is not nested inside the draft link',
);

// Cleanup runs on a schedule, not only when someone happens to call the API.
const cleanupCron = vercel.crons.find((entry) => entry.path === '/api/cron/application-draft-cleanup');
assert.ok(cleanupCron, 'a daily cron runs draft cleanup');
assert.match(cleanupCron.schedule, /^\d+ \d+ \* \* \*$/, 'the cleanup cron runs daily');
assert.match(cron, /CRON_SECRET/, 'the cleanup route only runs for the scheduler');
assert.match(cron, /timingSafeEqual/, 'the cron secret is compared in constant time');
assert.match(cron, /cleanupExpiredApplicationDraftsForAllOrganisations/, 'the cron cleans every organisation');

// A draft that can never be claimed must not fill every batch and block the rest.
assert.match(
  service,
  /findMany\(\{\s*where: \{\s*organisationId,\s*resultingProjectId: null,\s*expiresAt: \{ lte: new Date\(\) \}/,
  'expired-draft batches only select drafts the claim can update',
);
assert.match(service, /more: expired\.length === EXPIRED_DRAFT_BATCH/, 'cleanup reports when another batch may be needed');

console.log('application draft expiry tests passed');
