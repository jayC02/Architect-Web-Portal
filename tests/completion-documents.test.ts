import assert from 'node:assert/strict';
import { DocumentType } from '@prisma/client';
import {
  COMPLETION_DOCUMENT_ROLES,
  completionDocumentRole,
  extractCompletionDetailsFromText,
  normaliseCompletionAnalysis,
  recogniseCompletionDocument,
} from '../src/lib/completion-documents';
import {
  applyCompletionDocuments,
  completionIssues,
  completionPreparationSchema,
  emptyCompletionPreparation,
  type CompletionParties,
} from '../src/lib/completion-certificate';

const parties: CompletionParties = {
  client: { title: 'Ms', firstName: 'L', lastName: 'MacDonald', buildingNumber: '8', addressLine1: 'Harperbank Grove',
    townCity: 'Cumnock', postcode: 'KA18 1EN', country: 'United Kingdom' },
  agent: { firstName: 'Alex', lastName: 'Agent', email: 'agent@example.com', phone: '07000000000', buildingNumber: '1',
    addressLine1: 'High Street', townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom' },
};
const today = new Date('2026-11-13T12:00:00.000Z');

// ---- roles --------------------------------------------------------------------
assert.deepEqual(COMPLETION_DOCUMENT_ROLES.map((role) => role.key), [
  'BUILDING_WARRANT', 'ENERGY_PERFORMANCE_CERTIFICATE', 'SUSTAINABILITY_STATEMENT', 'FIRE_SAFETY_DESIGN_SUMMARY',
  'CONSTRUCTION_CERTIFICATE', 'DESIGN_CERTIFICATE', 'OTHER', 'UNRECOGNISED',
]);
assert.equal(completionDocumentRole('BUILDING_WARRANT').sentToPortal, false, 'the warrant is only read for its details');
assert.equal(completionDocumentRole('ENERGY_PERFORMANCE_CERTIFICATE').sentToPortal, true);
assert.equal(completionDocumentRole('OTHER').sentToPortal, true, 'any other upload goes as a general supporting document');
assert.equal(completionDocumentRole('ENERGY_PERFORMANCE_CERTIFICATE').documentType, DocumentType.ENERGY);
assert.equal(completionDocumentRole('CONSTRUCTION_CERTIFICATE').documentType, DocumentType.CERTIFICATE);
assert.equal(completionDocumentRole('ENERGY_PERFORMANCE_CERTIFICATE').portalDescription, 'Energy Performance Certificate');

// ---- recognition from page text and filename ------------------------------------
const recognise = (text: string, filename = 'document.pdf') => recogniseCompletionDocument({ text, filename });
assert.equal(recognise('ENERGY PERFORMANCE CERTIFICATE (EPC) Dwellings Scotland'), 'ENERGY_PERFORMANCE_CERTIFICATE');
assert.equal(recognise('', 'EPC 8 Harperbank Grove.pdf'), 'ENERGY_PERFORMANCE_CERTIFICATE');
assert.equal(recognise('Statement of Sustainability — Bronze Active'), 'SUSTAINABILITY_STATEMENT');
assert.equal(recognise('FIRE SAFETY DESIGN SUMMARY Part 1'), 'FIRE_SAFETY_DESIGN_SUMMARY');
assert.equal(recognise('', 'FSDS final.pdf'), 'FIRE_SAFETY_DESIGN_SUMMARY');
assert.equal(recognise('Certificate of Construction issued by an approved certifier of construction'), 'CONSTRUCTION_CERTIFICATE');
assert.equal(recognise('Notice of Finalisation of Design Details (Form Q)'), 'DESIGN_CERTIFICATE');
assert.equal(recognise('Certificate of Design (Section 7) approved certifier of design'), 'DESIGN_CERTIFICATE');
assert.equal(recognise('East Ayrshire Council. Grant of Building Warrant. Warrant reference 26/01234/WARR'), 'BUILDING_WARRANT');
// A certificate mentioning its building warrant is still a certificate.
assert.equal(recognise('Certificate of Construction. Building warrant reference 26/01234/WARR'), 'CONSTRUCTION_CERTIFICATE');
assert.equal(recognise('Gas Safe landlord record'), 'UNRECOGNISED');

// ---- reading details from page text ------------------------------------------
const warrant = extractCompletionDetailsFromText('BUILDING_WARRANT',
  'Grant of Building Warrant\nWarrant Reference: 26/01234/WARR\nDate of Grant: 5/3/2026\nAmendment granted 01/06/2026');
assert.equal(warrant.warrantReference, '26/01234/WARR');
assert.equal(warrant.warrantDate, '2026-03-05');
const certificate = extractCompletionDetailsFromText('CONSTRUCTION_CERTIFICATE',
  'Certificate of Construction\nCertificate Number: CC-100\nCertifier SEL1 / C / 12345 signed 01/10/2026\nApproved body SEL1/CB/678 signed 02/10/2026');
assert.deepEqual(certificate.certificate, {
  certificateNumber: 'CC-100',
  certifierRegistration: { part1: 'SEL1', part2: 'C', number: '12345' },
  certifierSignatureDate: '2026-10-01',
  approvedBodyRegistration: { part1: 'SEL1', part2: 'CB', number: '678' },
  approvedBodySignatureDate: '2026-10-02',
});
// Codes from the other register are not used.
assert.equal(extractCompletionDetailsFromText('CONSTRUCTION_CERTIFICATE', 'SER1/D/1 and SER1/DB/2').certificate?.certifierRegistration.part1, '');
assert.deepEqual(extractCompletionDetailsFromText('ENERGY_PERFORMANCE_CERTIFICATE', 'anything'), {});

// ---- AI answers are checked before use -----------------------------------------
const ai = normaliseCompletionAnalysis({
  role: 'BUILDING_WARRANT', warrantReference: ' 26/01234/WARR ', warrantDate: '2026-03-05',
  amendmentDates: ['2026-06-01', 'not a date', '2026-07-09'],
});
assert.equal(ai?.role, 'BUILDING_WARRANT');
assert.equal(ai?.details.warrantReference, '26/01234/WARR');
assert.equal(ai?.details.amendmentDates, '01/06/2026\n09/07/2026');
assert.equal(normaliseCompletionAnalysis({ role: 'MADE_UP' }), null);
assert.equal(normaliseCompletionAnalysis('nonsense'), null);
assert.equal(normaliseCompletionAnalysis({ role: 'BUILDING_WARRANT', warrantDate: '2026-13-45' })?.details.warrantDate, undefined);
const aiCertificate = normaliseCompletionAnalysis({
  role: 'DESIGN_CERTIFICATE', certificateNumber: 'FQ-1',
  certifierRegistration: { part1: 'SER1', part2: 'D', number: '9' }, certifierSignatureDate: '2026-09-01',
  approvedBodyRegistration: { part1: 'NIC1', part2: 'DB', number: '4' }, approvedBodySignatureDate: '2026-09-02',
});
assert.equal(aiCertificate?.details.certificate?.certifierRegistration.part1, 'SER1');
assert.equal(aiCertificate?.details.certificate?.approvedBodyRegistration.part1, '', 'a construction code is not a design registration');

// ---- uploads drive the answers ---------------------------------------------------
const document = (documentId: string, role: string, details: Record<string, unknown> = {}) =>
  ({ documentId, filename: `${documentId}.pdf`, role, source: 'text', details });
const base = { ...emptyCompletionPreparation(), designCertificates: { accompaniedWarrant: false, formQRequired: null, entries: [] } };

{
  const applied = applyCompletionDocuments(base as never);
  assert.equal(applied.energyPerformanceCertificate, false, 'nothing uploaded means No');
  assert.equal(applied.sustainabilityStatement, false);
  assert.equal(applied.fireSafetyDesignSummary, false);
  assert.equal(applied.constructionCertificates.accompany, false);
  assert.deepEqual(applied.constructionCertificates.entries, []);
}
{
  const applied = applyCompletionDocuments({ ...base, energyPerformanceCertificate: true, sustainabilityStatement: true } as never);
  assert.equal(applied.energyPerformanceCertificate, false, 'a Yes answer without a document becomes No');
  assert.equal(applied.sustainabilityStatement, false);
}
{
  const applied = applyCompletionDocuments({ ...base, documents: [
    document('epc', 'ENERGY_PERFORMANCE_CERTIFICATE'), document('sos', 'SUSTAINABILITY_STATEMENT'),
    document('fsds', 'FIRE_SAFETY_DESIGN_SUMMARY'),
  ] } as never);
  assert.equal(applied.energyPerformanceCertificate, true);
  assert.equal(applied.sustainabilityStatement, true);
  assert.equal(applied.fireSafetyDesignSummary, true);
}
{
  const applied = applyCompletionDocuments({ ...base, documents: [
    document('cc1', 'CONSTRUCTION_CERTIFICATE', { certificate: certificate.certificate }),
    document('cc2', 'CONSTRUCTION_CERTIFICATE'),
  ] } as never);
  assert.equal(applied.constructionCertificates.accompany, true);
  assert.deepEqual(applied.constructionCertificates.entries.map((entry) => entry.documentId), ['cc1', 'cc2']);
  assert.equal(applied.constructionCertificates.entries[0].certificateNumber, 'CC-100', 'details read from the certificate fill its entry');
  assert.equal(applied.constructionCertificates.entries[1].certificateNumber, '');
  assert.equal(applied.constructionCertificates.entries[1].certifierRegistration.part2, 'C');
}
{
  // Entries already edited are kept; entries whose document was removed go.
  const edited = { ...base, documents: [document('cc1', 'CONSTRUCTION_CERTIFICATE')],
    constructionCertificates: { accompany: true, entries: [
      { certificateNumber: 'EDITED', certifierRegistration: { part1: 'NIC1', part2: 'C', number: '5' }, certifierSignatureDate: '2026-10-01',
        approvedBodyRegistration: { part1: 'NIC1', part2: 'CB', number: '6' }, approvedBodySignatureDate: '2026-10-02', documentId: 'cc1' },
      { certificateNumber: 'GONE', certifierRegistration: { part1: '', part2: 'C', number: '' }, certifierSignatureDate: null,
        approvedBodyRegistration: { part1: '', part2: 'CB', number: '' }, approvedBodySignatureDate: null, documentId: 'removed' },
    ] } };
  const applied = applyCompletionDocuments(edited as never);
  assert.deepEqual(applied.constructionCertificates.entries.map((entry) => entry.certificateNumber), ['EDITED']);
}
{
  const withDesign = (accompaniedWarrant: boolean | null, documents: unknown[]) =>
    applyCompletionDocuments({ ...base, designCertificates: { accompaniedWarrant, formQRequired: null, entries: [] }, documents } as never)
      .designCertificates;
  assert.deepEqual(withDesign(true, []), { accompaniedWarrant: true, formQRequired: false, entries: [] });
  assert.equal(withDesign(true, [document('fq', 'DESIGN_CERTIFICATE')]).formQRequired, true);
  assert.equal(withDesign(true, [document('fq', 'DESIGN_CERTIFICATE')]).entries[0].certifierRegistration.part2, 'D');
  assert.deepEqual(withDesign(false, [document('fq', 'DESIGN_CERTIFICATE')]), { accompaniedWarrant: false, formQRequired: null, entries: [] },
    'Form Q is only asked when design certificates accompanied the warrant');
}

// ---- issues -----------------------------------------------------------------------
const complete = {
  ...base, workCompletedDate: '2026-10-30', warrantReference: '26/01234/WARR', warrantDate: '2026-03-05',
  relaxation: { applies: false, reference: null, date: null }, continuingRequirements: { applies: false, details: null },
};
assert.deepEqual(completionIssues(complete as never, parties, today), [], 'no uploads is a complete answer');
assert.deepEqual(
  completionIssues({ ...complete, documents: [document('x', 'UNRECOGNISED')] } as never, parties, today).map((issue) => issue.field),
  ['documents.x'],
  'an unrecognised upload needs a type before sending',
);
assert.deepEqual(
  completionIssues({ ...complete, documents: [document('cc1', 'CONSTRUCTION_CERTIFICATE')] } as never, parties, today).map((issue) => issue.field),
  ['constructionCertificates.entries.0'],
  'a certificate whose details could not be read needs them filled in',
);
assert.deepEqual(
  completionIssues({ ...complete, documents: [document('cc1', 'CONSTRUCTION_CERTIFICATE', { certificate: certificate.certificate })] } as never, parties, today),
  [],
);

// ---- saved shape ------------------------------------------------------------------
assert.deepEqual(completionPreparationSchema.parse({}).documents, [], 'older saved answers have no documents');
assert.equal(completionPreparationSchema.safeParse({ documents: [document('x', 'NOT_A_ROLE')] }).success, false);
assert.equal(completionPreparationSchema.safeParse({ documents: Array.from({ length: 41 }, (_, i) => document(`d${i}`, 'OTHER')) }).success, false);

console.log('completion-documents: ok');
