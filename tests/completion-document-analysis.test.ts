import assert from 'node:assert/strict';
import {
  COMPLETION_DOCUMENT_PROMPT,
  analyseCompletionDocument,
  createConfiguredCompletionDocumentReader,
} from '../src/server/services/completion-document-analysis.service';

const pdf = { bytes: Buffer.from('%PDF-1.4 test'), filename: 'scan.pdf', mimeType: 'application/pdf' };
const text = (value: string) => async () => value;
const reader = (answer: unknown) => {
  const calls: string[] = [];
  return { calls, reader: { name: 'test', read: async (input: { filename: string }) => { calls.push(input.filename); return answer; } } };
};

// A valid AI answer is used.
{
  const { reader: ai, calls } = reader({ role: 'BUILDING_WARRANT', warrantReference: '26/01234/WARR', warrantDate: '2026-03-05' });
  const result = await analyseCompletionDocument(pdf, { reader: ai, readText: text('ignored') });
  assert.deepEqual(calls, ['scan.pdf']);
  assert.equal(result.role, 'BUILDING_WARRANT');
  assert.equal(result.source, 'ai');
  assert.equal(result.details.warrantReference, '26/01234/WARR');
}

// An AI answer that is not a known type falls back to the page text.
{
  const { reader: ai } = reader({ role: 'MADE_UP' });
  const result = await analyseCompletionDocument(pdf, { reader: ai, readText: text('Energy Performance Certificate') });
  assert.equal(result.role, 'ENERGY_PERFORMANCE_CERTIFICATE');
  assert.equal(result.source, 'text');
}

// An AI failure falls back too; the upload is never lost.
{
  const failing = { name: 'test', read: async () => { throw new Error('provider down'); } };
  const result = await analyseCompletionDocument(pdf, { reader: failing, readText: text('Certificate of Construction SEL1/C/12345 01/10/2026') });
  assert.equal(result.role, 'CONSTRUCTION_CERTIFICATE');
  assert.equal(result.details.certificate?.certifierRegistration.number, '12345');
}

// No AI configured: page text, then filename.
{
  const result = await analyseCompletionDocument({ ...pdf, filename: 'FSDS.pdf' }, { reader: null, readText: text('') });
  assert.equal(result.role, 'FIRE_SAFETY_DESIGN_SUMMARY');
  assert.equal(result.source, 'text');
}

// Not a PDF: only the filename can help, and the AI is not sent it.
{
  const { reader: ai, calls } = reader({ role: 'OTHER' });
  const result = await analyseCompletionDocument({ bytes: Buffer.from('x'), filename: 'EPC photo.jpg', mimeType: 'image/jpeg' },
    { reader: ai, readText: text('should not be read') });
  assert.deepEqual(calls, []);
  assert.equal(result.role, 'ENERGY_PERFORMANCE_CERTIFICATE');
}

// Nothing recognisable.
assert.equal((await analyseCompletionDocument(pdf, { reader: null, readText: text('Gas safety record') })).role, 'UNRECOGNISED');

// The prompt names every type the reader may answer with.
for (const key of ['BUILDING_WARRANT', 'ENERGY_PERFORMANCE_CERTIFICATE', 'SUSTAINABILITY_STATEMENT', 'FIRE_SAFETY_DESIGN_SUMMARY',
  'CONSTRUCTION_CERTIFICATE', 'DESIGN_CERTIFICATE', 'OTHER']) {
  assert.ok(COMPLETION_DOCUMENT_PROMPT.includes(key), key);
}

// No provider configured: no reader, so uploads still work from page text.
{
  const saved = process.env.DOCUMENT_AI_PROVIDER;
  delete process.env.DOCUMENT_AI_PROVIDER;
  assert.equal(createConfiguredCompletionDocumentReader(), null);
  if (saved !== undefined) process.env.DOCUMENT_AI_PROVIDER = saved;
}

console.log('completion-document-analysis: ok');
