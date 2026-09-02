import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isUnavailableGmailMessageError } from '../src/server/services/gmail-sync.service';

assert.equal(
  isUnavailableGmailMessageError({ googleStatus: 404 }),
  true,
  'deleted Gmail messages are recognised as unavailable',
);
assert.equal(
  isUnavailableGmailMessageError({ googleStatus: 500 }),
  false,
  'transient Gmail failures are not mistaken for deleted messages',
);
assert.equal(
  isUnavailableGmailMessageError(new Error('Requested entity was not found.')),
  false,
  'the recovery path relies on the Gmail status, not a brittle message match',
);

const syncSource = fs.readFileSync(
  new URL('../src/server/services/gmail-sync.service.ts', import.meta.url),
  'utf8',
);
assert.match(
  syncSource,
  /const metadataPayload = await readMessageIfAvailable[\s\S]*?unavailable \+= 1;[\s\S]*?continue;/,
  'an unavailable metadata message is skipped instead of failing the sync',
);
assert.match(
  syncSource,
  /gmailHistoryId: failed \? startingHistoryId : proposedHistoryId/,
  'the Gmail history cursor advances when only unavailable messages were skipped',
);
assert.match(
  syncSource,
  /PlanningStatus\.NOT_STARTED,[\s\S]*?PlanningStatus\.DRAFTING/,
  'draft Planning applications participate in initial submission-email matching',
);
assert.match(
  syncSource,
  /WarrantStatus\.NOT_STARTED,[\s\S]*?WarrantStatus\.DRAFTING/,
  'draft Building Warrant applications participate in initial submission-email matching',
);

const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  crons?: Array<{ path?: string; schedule?: string }>;
};
assert.ok(
  vercel.crons?.some((cron) => cron.path === '/api/cron/gmail-sync' && Boolean(cron.schedule)),
  'Gmail sync remains configured to run automatically in production',
);

console.log('gmail sync resilience tests passed');
