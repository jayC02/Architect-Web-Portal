import assert from 'node:assert/strict';
import {
  COMPLETION_FIXED_ANSWERS,
  CONSTRUCTION_REGISTRATION_PART1_CODES,
  REGISTER_PART2,
  certificateEntrySchema,
  completionIssues,
  completionPrefill,
  completionPreparationSchema,
  emptyCompletionPreparation,
  formatPortalDate,
  mergeCompletionPreparation,
  type CompletionParties,
  type CompletionPreparation,
} from '../src/lib/completion-certificate';

const today = new Date('2026-11-11T12:00:00.000Z');

// Constants copied from the portal.
assert.deepEqual([...CONSTRUCTION_REGISTRATION_PART1_CODES], ['NIC1', 'SEL1', 'SNP1']);
assert.deepEqual(REGISTER_PART2, {
  construction: { certifier: 'C', approvedBody: 'CB' },
  design: { certifier: 'D', approvedBody: 'DB' },
});
assert.deepEqual(COMPLETION_FIXED_ANSWERS, {
  warrantObtained: true,
  dangerousBuildingNotice: false,
  actingAs: 'AGENT',
  useAccountDetails: true,
  relevantPersonType: 'INDIVIDUAL',
  relevantPersonIsOwner: true,
  differentBuildingAddress: false,
  coversAllWork: true,
});

// Prefill.
const prefill = completionPrefill({
  warrantReference: '26/01234/WARR',
  grantedDate: new Date('2026-03-05T00:00:00.000Z'),
  amendmentGrantedDates: [new Date('2026-06-01T00:00:00.000Z'), new Date('2026-07-09T00:00:00.000Z')],
  warrantPreparation: {
    scottishMinistersRelaxationDirection: true,
    relaxationReference: 'RD/1',
    relaxationDate: '2026-02-01',
    approvedCertifierOfConstruction: false,
    designCertifierSelected: true,
  },
  certifier: { registrationAPart1: 'SER1', registrationAPart2: '1234', registrationBPart1: 'SER1', registrationBPart2: '77' },
});
assert.equal(prefill.workCompletedDate, null, 'work-completed date is never defaulted');
assert.equal(prefill.warrantReference, '26/01234/WARR');
assert.equal(prefill.warrantDate, '2026-03-05');
assert.equal(prefill.amendmentDates, '01/06/2026\n09/07/2026');
assert.deepEqual(prefill.relaxation, { applies: true, reference: 'RD/1', date: '2026-02-01' });
assert.equal(prefill.constructionCertificates.accompany, false);
assert.deepEqual(prefill.constructionCertificates.entries, []);
assert.equal(prefill.designCertificates.accompaniedWarrant, true);
assert.equal(prefill.designCertificates.formQRequired, null);
assert.deepEqual(prefill.designCertificates.entries[0].certifierRegistration, { part1: 'SER1', part2: 'D', number: '1234' });
assert.deepEqual(prefill.designCertificates.entries[0].approvedBodyRegistration, { part1: 'SER1', part2: 'DB', number: '77' });
assert.equal(prefill.energyPerformanceCertificate, null);
assert.equal(prefill.sustainabilityStatement, null);
assert.equal(prefill.fireSafetyDesignSummary, null);
assert.equal(prefill.continuingRequirements.applies, null);

const barePrefill = completionPrefill({
  warrantReference: null, grantedDate: null, amendmentGrantedDates: [], warrantPreparation: {}, certifier: null,
});
assert.equal(barePrefill.warrantDate, null);
assert.equal(barePrefill.amendmentDates, null);
assert.equal(barePrefill.relaxation.applies, null);
assert.deepEqual(barePrefill.designCertificates.entries, []);
assert.deepEqual(barePrefill, emptyCompletionPreparation());

// The first relaxation direction is preferred over the legacy single fields.
assert.deepEqual(completionPrefill({
  warrantReference: null, grantedDate: null, amendmentGrantedDates: [], certifier: null,
  warrantPreparation: { scottishMinistersRelaxationDirection: true, relaxationDirections: [{ reference: 'RD/9', date: '2026-01-15' }], relaxationReference: 'old' },
}).relaxation, { applies: true, reference: 'RD/9', date: '2026-01-15' });

// Merge: a saved answer wins, prefill fills the gaps.
const merged = mergeCompletionPreparation(
  { workCompletedDate: '2026-10-30', warrantReference: '26/09999/WARR', relaxation: { applies: false, reference: null, date: null } },
  prefill,
);
assert.equal(merged.workCompletedDate, '2026-10-30');
assert.equal(merged.warrantReference, '26/09999/WARR');
assert.equal(merged.warrantDate, '2026-03-05');
assert.equal(merged.relaxation.applies, false);
assert.equal(merged.designCertificates.entries.length, 1, 'prefilled entries stay when none were saved');
assert.deepEqual(mergeCompletionPreparation(null, prefill), prefill);
assert.deepEqual(mergeCompletionPreparation('not an object', prefill), prefill);

const entry = (register: 'construction' | 'design') => ({
  certificateNumber: 'CERT-1',
  certifierRegistration: { part1: register === 'construction' ? 'SEL1' : 'SER1', part2: REGISTER_PART2[register].certifier, number: '12345' },
  certifierSignatureDate: '2026-10-01',
  approvedBodyRegistration: { part1: register === 'construction' ? 'SEL1' : 'SER1', part2: REGISTER_PART2[register].approvedBody, number: '678' },
  approvedBodySignatureDate: '2026-10-02',
  documentId: null,
});

const complete: CompletionPreparation = {
  workCompletedDate: '2026-10-30',
  warrantReference: '26/01234/WARR',
  warrantDate: '2026-03-05',
  amendmentDates: '01/06/2026',
  relaxation: { applies: true, reference: 'RD/1', date: '2026-02-01' },
  constructionCertificates: { accompany: true, entries: [entry('construction')] },
  designCertificates: { accompaniedWarrant: true, formQRequired: true, entries: [entry('design')] },
  energyPerformanceCertificate: true,
  sustainabilityStatement: false,
  fireSafetyDesignSummary: false,
  continuingRequirements: { applies: true, details: 'Maintain the fire door.' },
  confirmedAt: null,
};
const parties: CompletionParties = {
  client: { title: 'Mr', firstName: 'Sam', lastName: 'Client', buildingNumber: '112', addressLine1: 'Ralston Avenue',
    townCity: 'Glasgow', postcode: 'G52 3NB', country: 'United Kingdom' },
  agent: { firstName: 'Alex', lastName: 'Agent', email: 'agent@example.com', phone: '07000000000', buildingNumber: '1',
    addressLine1: 'High Street', townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom' },
};

assert.equal(completionPreparationSchema.safeParse(complete).success, true);
assert.deepEqual(completionIssues(complete, parties, today), []);

const fields = (preparation: CompletionPreparation, who: CompletionParties = parties) =>
  completionIssues(preparation, who, today).map((issue) => issue.field);
const withPreparation = (change: Partial<CompletionPreparation>) => ({ ...complete, ...change });

assert.deepEqual(fields(withPreparation({ workCompletedDate: null })), ['workCompletedDate']);
assert.deepEqual(fields(withPreparation({ workCompletedDate: '2999-01-01' })), ['workCompletedDate']);
assert.deepEqual(fields(withPreparation({ warrantReference: null })), ['warrantReference']);
assert.deepEqual(fields(withPreparation({ warrantReference: '   ' })), ['warrantReference']);
assert.deepEqual(fields(withPreparation({ warrantDate: null })), ['warrantDate']);
assert.deepEqual(fields(withPreparation({ warrantDate: '2999-01-01' })), ['warrantDate']);
assert.deepEqual(fields(withPreparation({ relaxation: { applies: null, reference: null, date: null } })), ['relaxation.applies']);
assert.deepEqual(fields(withPreparation({ relaxation: { applies: true, reference: null, date: '2026-02-01' } })), ['relaxation.reference']);
assert.deepEqual(fields(withPreparation({ relaxation: { applies: true, reference: 'RD/1', date: null } })), ['relaxation.date']);
assert.deepEqual(fields(withPreparation({ relaxation: { applies: false, reference: null, date: null } })), []);
// Certificates follow the uploads: no certificate document means No, whatever was answered.
assert.deepEqual(fields(withPreparation({ constructionCertificates: { accompany: null, entries: [] } })), []);
assert.deepEqual(fields(withPreparation({ constructionCertificates: { accompany: true, entries: [] } })), []);
assert.deepEqual(fields(withPreparation({ constructionCertificates: { accompany: false, entries: [] } })), []);
const certificateDocument = (documentId: string) => ({ documentId, filename: `${documentId}.pdf`, role: 'CONSTRUCTION_CERTIFICATE', source: 'manual', details: {} });
const withCertificates = (...entries: CompletionPreparation['constructionCertificates']['entries']) => withPreparation({
  documents: entries.map((item) => certificateDocument(item.documentId!)) as never,
  constructionCertificates: { accompany: true, entries },
});
assert.deepEqual(
  fields(withCertificates({ ...entry('construction'), documentId: 'cc1', certifierRegistration: { part1: 'BRE1', part2: 'C', number: '1' } })),
  ['constructionCertificates.entries.0'],
  'a design-scheme code is not accepted in the construction register',
);
assert.deepEqual(
  fields(withCertificates({ ...entry('construction'), documentId: 'cc1' }, { ...entry('construction'), documentId: 'cc2', certificateNumber: '' })),
  ['constructionCertificates.entries.1'],
);
assert.deepEqual(
  fields(withCertificates({ ...entry('construction'), documentId: 'cc1', certifierSignatureDate: null })),
  ['constructionCertificates.entries.0'],
);
assert.deepEqual(fields(withCertificates({ ...entry('construction'), documentId: 'cc1' })), []);
assert.deepEqual(fields(withPreparation({ designCertificates: { accompaniedWarrant: null, formQRequired: null, entries: [] } })), ['designCertificates.accompaniedWarrant']);
// Form Q follows the uploads too: no Form Q document means No.
assert.deepEqual(fields(withPreparation({ designCertificates: { accompaniedWarrant: true, formQRequired: null, entries: [] } })), []);
assert.deepEqual(fields(withPreparation({ designCertificates: { accompaniedWarrant: true, formQRequired: true, entries: [] } })), []);
assert.deepEqual(fields(withPreparation({ designCertificates: { accompaniedWarrant: true, formQRequired: false, entries: [] } })), []);
assert.deepEqual(fields(withPreparation({ designCertificates: { accompaniedWarrant: false, formQRequired: null, entries: [] } })), []);
// These are answered by uploading the document; with nothing uploaded they are No, not missing.
assert.deepEqual(fields(withPreparation({ energyPerformanceCertificate: null })), []);
assert.deepEqual(fields(withPreparation({ sustainabilityStatement: null })), []);
assert.deepEqual(fields(withPreparation({ fireSafetyDesignSummary: null })), []);
assert.deepEqual(fields(withPreparation({ continuingRequirements: { applies: null, details: null } })), ['continuingRequirements.applies']);
assert.deepEqual(fields(withPreparation({ continuingRequirements: { applies: true, details: ' ' } })), ['continuingRequirements.details']);
assert.deepEqual(fields(withPreparation({ continuingRequirements: { applies: false, details: null } })), []);

// Relevant person and agent.
assert.deepEqual(fields(complete, { ...parties, client: null }), ['client']);
assert.deepEqual(fields(complete, { ...parties, client: { ...parties.client!, title: null } }), ['client.title']);
assert.deepEqual(fields(complete, { ...parties, client: { ...parties.client!, title: 'Dr' } }), [], 'an unlisted title is sent as Other');
assert.deepEqual(fields(complete, { ...parties, client: { ...parties.client!, buildingNumber: null } }), ['client.buildingNumber']);
assert.deepEqual(fields(complete, { ...parties, client: { ...parties.client!, postcode: null } }), ['client.postcode']);
assert.deepEqual(fields(complete, { ...parties, client: { ...parties.client!, postcode: null, country: 'France' } }), [], 'postcode is required for UK addresses only');
assert.deepEqual(fields(complete, { ...parties, agent: { ...parties.agent, email: null } }), ['agent.email']);
const clientIssue = completionIssues(complete, { ...parties, client: { ...parties.client!, title: null } }, today)[0];
assert.match(clientIssue.message, /^Client record:/);

// Limits.
assert.equal(completionPreparationSchema.safeParse({ ...complete, amendmentDates: 'x'.repeat(750) }).success, true);
assert.equal(completionPreparationSchema.safeParse({ ...complete, amendmentDates: 'x'.repeat(751) }).success, false);
assert.equal(completionPreparationSchema.safeParse({ ...complete, continuingRequirements: { applies: true, details: 'x'.repeat(750) } }).success, true);
assert.equal(completionPreparationSchema.safeParse({ ...complete, continuingRequirements: { applies: true, details: 'x'.repeat(751) } }).success, false);
assert.equal(
  completionPreparationSchema.safeParse({ ...complete, constructionCertificates: { accompany: true, entries: Array.from({ length: 21 }, () => entry('construction')) } }).success,
  false,
);
assert.equal(completionPreparationSchema.parse({ ...complete, amendmentDates: '01/06/2026\n09/07/2026' }).amendmentDates, '01/06/2026\n09/07/2026');
assert.equal(completionPreparationSchema.safeParse({ ...complete, workCompletedDate: '30/10/2026' }).success, false);
assert.equal(completionPreparationSchema.parse({ ...complete, workCompletedDate: '' }).workCompletedDate, null);

// Resolved entries for the job snapshot.
assert.equal(certificateEntrySchema('construction').safeParse(entry('construction')).success, true);
assert.equal(certificateEntrySchema('construction').safeParse(entry('design')).success, false);
assert.equal(certificateEntrySchema('design').safeParse(entry('design')).success, true);
assert.equal(certificateEntrySchema('design').safeParse({ ...entry('design'), approvedBodySignatureDate: null }).success, false);

// Dates.
assert.equal(formatPortalDate('2026-03-05'), '05/03/2026');
assert.equal(formatPortalDate('2026-12-31'), '31/12/2026');
assert.throws(() => formatPortalDate('2026-13-40'));
assert.throws(() => formatPortalDate('05/03/2026'));
assert.throws(() => formatPortalDate('2026-02-30'));

console.log('completion-certificate-preparation: ok');
