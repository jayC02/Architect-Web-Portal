// The Completion Certificate answers that used to be fixed (docs/completion-certificate-portal-map.md).
import assert from 'node:assert/strict';
import {
  completionIssues,
  completionPreparationSchema,
  emptyCompletionOwner,
  mergeCompletionPreparation,
  completionPrefill,
  type CompletionParties,
  type CompletionPreparation,
} from '../src/lib/completion-certificate';

const today = new Date('2026-11-11T12:00:00.000Z');
const parties: CompletionParties = {
  client: { title: 'Mr', firstName: 'Sam', lastName: 'Client', buildingNumber: '112', addressLine1: 'Ralston Avenue',
    townCity: 'Glasgow', postcode: 'G52 3NB', country: 'United Kingdom', companyName: null },
  agent: { firstName: 'Alex', lastName: 'Agent', email: 'agent@example.com', phone: '07000000000', buildingNumber: '1',
    addressLine1: 'High Street', townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom' },
};
const base: CompletionPreparation = completionPreparationSchema.parse({
  workCompletedDate: '2026-10-30', warrantReference: '26/01234/WARR', warrantDate: '2026-03-05',
  relaxation: { applies: false }, constructionCertificates: { accompany: false }, designCertificates: { accompaniedWarrant: false },
  continuingRequirements: { applies: false },
  dangerousBuilding: { applies: false }, relevantPersonIsOwner: true, differentAddress: { applies: false },
  coverage: { coversAllWork: true }, declaration: { person: 'I', statement: 'WORK' },
});
const fields = (preparation: CompletionPreparation, who = parties) =>
  completionIssues(preparation, who, today).map((issue) => issue.field);

assert.deepEqual(fields(base), [], 'the old fixed answers are a complete answer');

// Every formerly fixed question must be answered.
const unanswered = completionPreparationSchema.parse({ ...base, dangerousBuilding: {}, relevantPersonIsOwner: null,
  differentAddress: {}, coverage: {}, declaration: {} });
for (const field of ['dangerousBuilding.applies', 'relevantPersonIsOwner', 'differentAddress.applies',
  'coverage.coversAllWork', 'declaration.person', 'declaration.statement']) {
  assert.ok(fields(unanswered).includes(field), `${field} must be answered`);
}

// Follow-ups follow their answers.
assert.ok(fields({ ...base, dangerousBuilding: { applies: true, references: ' ' } }).includes('dangerousBuilding.references'));
assert.deepEqual(fields({ ...base, dangerousBuilding: { applies: true, references: 'DBN/1' } }), []);
assert.ok(fields({ ...base, coverage: { coversAllWork: false, workDescription: null, lastSubmission: null } })
  .includes('coverage.workDescription'));
assert.ok(fields({ ...base, coverage: { coversAllWork: false, workDescription: 'Plot 1', lastSubmission: null } })
  .includes('coverage.lastSubmission'));
assert.ok(fields({ ...base, differentAddress: { applies: true, addresses: [] } }).includes('differentAddress.addresses'));
assert.ok(fields({ ...base, differentAddress: { applies: true, addresses: [{ addressLine1: 'Plot 1', addressLine2: '', townCity: 'Glasgow', postcode: '' }] } })
  .includes('differentAddress.addresses.0.postcode'));

// Owners: the portal requires name, phone, email and address for every owner, a company included.
const owner = { ...emptyCompletionOwner(), title: 'Mr', firstName: 'Ann', lastName: 'Owner', phone: '0141 000 0000',
  email: 'ann@example.com', buildingNumber: '4', addressLine1: 'Willow Court', townCity: 'Glasgow', postcode: 'G1 1AA',
  country: 'United Kingdom' };
assert.ok(fields({ ...base, relevantPersonIsOwner: false, owners: [] }).includes('owners'));
assert.deepEqual(fields({ ...base, relevantPersonIsOwner: false, owners: [owner] }), []);
const company = { ...owner, company: 'Owner Ltd', firstName: '', lastName: '' };
assert.ok(fields({ ...base, relevantPersonIsOwner: false, owners: [company] }).includes('owners.0.firstName'),
  'a company owner still needs a name');
assert.ok(fields({ ...base, relevantPersonIsOwner: false, owners: [{ ...owner, buildingNumber: '' }] }).includes('owners.0.buildingNumber'));
assert.ok(fields({ ...base, relevantPersonIsOwner: false, owners: [{ ...owner, title: 'Other' }] }).includes('owners.0.otherTitle'));
assert.ok(fields({ ...base, relevantPersonIsOwner: false, owners: [{ ...owner, title: 'Dr' }] }).includes('owners.0.title'));

// An organisation client is entered by its company: a title is still required, its names are not.
const organisation: CompletionParties = { ...parties, client: { ...parties.client!, firstName: null, lastName: null, companyName: 'Client Ltd' } };
assert.deepEqual(fields(base, organisation), []);
assert.ok(fields(base, { ...organisation, client: { ...organisation.client!, title: null } }).includes('client.title'));
assert.ok(fields(base, { ...parties, client: { ...parties.client!, firstName: null } }).includes('client.firstName'),
  'a person client still needs a first name');

// A saved answer wins over the prefill; an unanswered one takes it.
const prefill = completionPrefill({ warrantReference: null, grantedDate: null, amendmentGrantedDates: [], warrantPreparation: {}, certifier: null });
const merged = mergeCompletionPreparation({ relevantPersonIsOwner: false, owners: [owner], declaration: { person: 'We' } }, prefill);
assert.equal(merged.relevantPersonIsOwner, false);
assert.equal(merged.owners[0].firstName, 'Ann');
assert.deepEqual(merged.declaration, { person: 'We', statement: 'WORK' });
assert.equal(mergeCompletionPreparation({}, prefill).coverage.coversAllWork, true);

console.log('completion-certificate-branches: ok');
