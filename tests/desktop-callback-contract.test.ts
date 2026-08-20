import assert from 'node:assert/strict';
import fs from 'node:fs';
import { desktopJobStatusSchema } from '../src/lib/validation/desktop-handoff';

type ContractFixture = {
  name: string;
  callback: Record<string, unknown>;
};

const fixtures = JSON.parse(fs.readFileSync(
  new URL('./fixtures/desktop-callback-contract-v1.json', import.meta.url),
  'utf8',
)) as ContractFixture[];

for (const fixture of fixtures) {
  assert.deepEqual(
    desktopJobStatusSchema.parse(fixture.callback),
    fixture.callback,
    `${fixture.name} must be accepted exactly by the web callback contract`,
  );
}

const fee = fixtures.find((fixture) => fixture.name === 'fee_handoff')!.callback;
assert.equal(fee.status, 'AWAITING_PORTAL_REVIEW');
assert.equal((fee.result as Record<string, unknown>).outcome, 'awaiting_user_portal_review');
assert.equal((fee.result as Record<string, unknown>).currentSection, 'fee');

const prepared = fixtures.find((fixture) => fixture.name === 'successful_final_review')!.callback;
assert.equal(prepared.status, 'COMPLETED');
assert.equal((prepared.result as Record<string, unknown>).outcome, 'completed_to_final_review');
assert.equal((prepared.result as Record<string, unknown>).currentSection, 'final_review');
assert.equal((prepared.result as Record<string, unknown>).userActionRequired, null);

assert.throws(
  () => desktopJobStatusSchema.parse({ ...fee, version: 2 }),
  /Unsupported desktop callback version/,
  'unsupported callback versions fail with a clear contract error',
);
assert.throws(
  () => desktopJobStatusSchema.parse({ ...fee, occurredAt: undefined }),
  'every callback requires its original occurrence timestamp',
);

const callbackRoute = fs.readFileSync(
  new URL('../src/pages/api/desktop/automation-jobs/[id]/index.ts', import.meta.url),
  'utf8',
);
assert.match(callbackRoute, /body\.jobId !== id/, 'callback body job identity must match the scoped route');
assert.match(callbackRoute, /WHERE "idempotencyKey" = \$\{body\.callbackId\}/, 'callback UUID is the persisted idempotency key');
assert.match(callbackRoute, /if \(duplicate\.length\) return \{ duplicate: true/, 'duplicate delivery returns without another semantic result');

console.log('desktop callback contract tests passed');
