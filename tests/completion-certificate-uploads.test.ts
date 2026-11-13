import assert from 'node:assert/strict';
import { HttpError } from '../src/lib/utils/http';
import {
  addCompletionDocument,
  saveCompletionPreparation,
} from '../src/server/services/completion-certificate.service';
import { completionDatabase, completePreparation } from './helpers/completion-certificate-database';

const today = new Date('2026-11-13T12:00:00.000Z');
const scope = { organisationId: 'org', warrantId: 'warrant_1', userId: 'user', today };
const file = (name: string, type = 'application/pdf') => new File([new Uint8Array([37, 80, 68, 70])], name, { type });
const saveFile = async (upload: File) => ({
  fileName: upload.name, storageUrl: `/uploads/${upload.name}`, storageKey: `org/${upload.name}`, mimeType: upload.type, sizeBytes: upload.size,
});
const analysedAs = (role: string, details: Record<string, unknown> = {}) => {
  const seen: string[] = [];
  return { seen, analyse: async (input: { filename: string }) => { seen.push(input.filename); return { role, source: 'ai', details } as never; } };
};

// A new upload is stored as a project document with a type matching what it is.
{
  const { database, state } = completionDatabase();
  const { analyse, seen } = analysedAs('ENERGY_PERFORMANCE_CERTIFICATE');
  const result = await addCompletionDocument({ ...scope, file: file('EPC.pdf') }, { database: database as never, analyse, saveFile });
  assert.deepEqual(seen, ['EPC.pdf']);
  const stored = state.documents.at(-1);
  assert.equal(stored.type, 'ENERGY');
  assert.equal(stored.projectId, 'project');
  assert.equal(stored.uploadedById, 'user');
  assert.equal(result.document.id, stored.id);
  assert.equal(result.preparation.energyPerformanceCertificate, true, 'uploading an EPC answers Yes');
  const saved = state.warrant.completionPreparationData as any;
  assert.deepEqual(saved.documents.map((item: any) => [item.documentId, item.role, item.source]), [[stored.id, 'ENERGY_PERFORMANCE_CERTIFICATE', 'ai']]);
}

// An uploaded warrant fills empty warrant fields, and never overwrites typed ones.
{
  const { database, state } = completionDatabase({ completionPreparationData: { warrantReference: 'TYPED BY ARCHITECT' } });
  state.warrant.grantedDate = null as never;
  const { analyse } = analysedAs('BUILDING_WARRANT', {
    warrantReference: '26/01234/WARR', warrantDate: '2026-03-05', amendmentDates: '01/06/2026',
  });
  const result = await addCompletionDocument({ ...scope, file: file('Warrant.pdf') }, { database: database as never, analyse, saveFile });
  assert.equal(result.preparation.warrantReference, 'TYPED BY ARCHITECT');
  assert.equal(result.preparation.warrantDate, '2026-03-05');
  assert.equal(result.preparation.amendmentDates, '01/06/2026');
  assert.equal(state.documents.at(-1).type, 'CORRESPONDENCE');
}

// A certificate's details fill its entry.
{
  const { database } = completionDatabase();
  const certificate = {
    certificateNumber: 'CC-7', certifierRegistration: { part1: 'NIC1', part2: 'C', number: '1' }, certifierSignatureDate: '2026-10-01',
    approvedBodyRegistration: { part1: 'NIC1', part2: 'CB', number: '2' }, approvedBodySignatureDate: '2026-10-02',
  };
  const { analyse } = analysedAs('CONSTRUCTION_CERTIFICATE', { certificate });
  const result = await addCompletionDocument({ ...scope, file: file('CC.pdf') }, { database: database as never, analyse, saveFile });
  assert.equal(result.preparation.constructionCertificates.accompany, true);
  assert.equal(result.preparation.constructionCertificates.entries[0].certificateNumber, 'CC-7');
  assert.ok(!result.issues.some((issue) => issue.field.startsWith('constructionCertificates')));
}

// An existing project document can be attached without uploading it again.
{
  const { database, state } = completionDatabase();
  const before = state.documents.length;
  const { analyse } = analysedAs('FIRE_SAFETY_DESIGN_SUMMARY');
  const result = await addCompletionDocument({ ...scope, documentId: 'doc_1' }, {
    database: database as never, analyse, saveFile, readBytes: async () => Buffer.from('%PDF'),
  });
  assert.equal(state.documents.length, before, 'no copy is made');
  assert.equal(result.preparation.fireSafetyDesignSummary, true);
  // Attaching it twice keeps one record.
  const again = await addCompletionDocument({ ...scope, documentId: 'doc_1' }, {
    database: database as never, analyse, saveFile, readBytes: async () => Buffer.from('%PDF'),
  });
  assert.equal(again.preparation.documents.filter((item) => item.documentId === 'doc_1').length, 1);
}

// Only this organisation's documents for this project can be attached.
{
  const { database, state } = completionDatabase();
  state.documents.push({ ...state.documents[0], id: 'other_project_doc', projectId: 'another-project' });
  const { analyse } = analysedAs('OTHER');
  for (const documentId of ['other_project_doc', 'missing']) {
    await assert.rejects(
      () => addCompletionDocument({ ...scope, documentId }, { database: database as never, analyse, saveFile, readBytes: async () => Buffer.from('') }),
      (error) => error instanceof HttpError && error.status === 404,
    );
  }
  await assert.rejects(
    () => addCompletionDocument({ ...scope, organisationId: 'other-org', file: file('x.pdf') }, { database: database as never, analyse, saveFile }),
    (error) => error instanceof HttpError && error.status === 404,
  );
  await assert.rejects(
    () => addCompletionDocument({ ...scope }, { database: database as never, analyse, saveFile }),
    (error) => error instanceof HttpError && error.status === 400,
  );
}

// Saving the page drops documents that are not this project's.
{
  const { database, state } = completionDatabase();
  state.documents.push({ ...state.documents[0], id: 'foreign', projectId: 'another-project' });
  await saveCompletionPreparation({
    organisationId: 'org', warrantId: 'warrant_1', today,
    body: { ...completePreparation, documents: [
      ...completePreparation.documents,
      { documentId: 'foreign', filename: 'x.pdf', role: 'OTHER', source: 'manual', details: {} },
    ] },
  }, database as never);
  const ids = (state.warrant.completionPreparationData as any).documents.map((item: any) => item.documentId);
  assert.ok(!ids.includes('foreign'));
  assert.ok(ids.includes('doc_epc'));
}

console.log('completion-certificate-uploads: ok');
