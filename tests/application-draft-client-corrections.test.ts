import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import { saveDraftClientCorrections } from '../src/server/services/application-draft-client.service';
import { clientReviewFixture } from './fixtures/client-applicant-review';
import { applicationDraftReviewSchema } from '../src/lib/validation/application-draft';
import { evaluateClientApplicationDraftReadiness } from '../src/lib/application-draft-readiness';
import { evaluateApplicationDraftReadiness } from '../src/server/services/application-draft.service';
import { normaliseDraftAddresses } from '../src/lib/addresses/draft-address';
import { selectDirectoryClient } from '../src/lib/clients/application-review';
import { savedClient } from './fixtures/client-applicant-review';

const writes: Prisma.ClientUpdateManyArgs[] = [];
let count = 1;
const tx = { client: { updateMany: async (args: Prisma.ClientUpdateManyArgs) => {
  writes.push(args); return { count };
} } } as unknown as Pick<Prisma.TransactionClient, 'client'>;
const review = selectDirectoryClient(clientReviewFixture().review!, savedClient);
await saveDraftClientCorrections(tx, 'organisation-1', review);
assert.equal(writes.length, 0, 'an untouched default never overwrites the directory');
const corrected = normaliseDraftAddresses(applicationDraftReviewSchema.parse({ ...review, clientDetailsEdited: true,
  client: { ...review.client, email: 'corrected@example.test', phone: null, addressLine2: null } }));
assert.equal(corrected.clientDetailsEdited, true, 'corrections survive validation and draft normalization');
await saveDraftClientCorrections(tx, 'organisation-1', corrected);
assert.deepEqual(writes[0].where, { id: savedClient.id, organisationId: 'organisation-1' });
assert.equal(writes[0].data.email, 'corrected@example.test');
assert.equal(writes[0].data.phone, null, 'optional details can be cleared');
assert.equal(writes[0].data.addressLine2, null);
assert.equal('notes' in writes[0].data, false, 'client notes are preserved');
assert.equal('clientType' in writes[0].data, false, 'only persisted client fields are written');
assert.equal(corrected.applicant?.email, 'corrected@example.test', 'same applicant receives corrections');
const before = writes.length;
await saveDraftClientCorrections(tx, 'organisation-1', { ...corrected, projectMode: 'existing' });
await saveDraftClientCorrections(tx, 'organisation-1', { ...corrected, clientMode: 'create' });
assert.equal(writes.length, before, 'other creation paths are unchanged');
count = 0;
await assert.rejects(saveDraftClientCorrections(tx, 'another-organisation', corrected), /not available/);
for (const evaluate of [evaluateClientApplicationDraftReadiness, evaluateApplicationDraftReadiness]) {
  const invalid = { ...corrected, client: { ...corrected.client, email: null, displayName: null } };
  assert.ok(evaluate(invalid).some(issue => issue.key === 'client.email'));
  assert.ok(evaluate(invalid).some(issue => issue.key === 'client.displayName'));
}
assert.equal(selectDirectoryClient(corrected, savedClient).clientDetailsEdited, false, 'selecting a client resets old corrections');
console.log('saved-client correction persistence and readiness tests passed');
