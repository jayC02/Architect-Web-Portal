import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/db/prisma';
import { enqueueDraftProcessing, runInlineDraftProcessing } from '../src/server/services/document-processing.service';
assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get('schema'), 'workflow_overhaul_preview_20261009');
const previous = process.env.DOCUMENT_PROCESSING_ENABLED;
process.env.DOCUMENT_PROCESSING_ENABLED = 'false';
try {
  const organisation = await prisma.organisation.create({ data: { name: 'Inline batch budget fixture', slug: `inline-batch-${randomUUID()}` } });
  const user = await prisma.user.create({ data: { name: 'Inline batch fixture', email: `inline-batch-${randomUUID()}@example.test`, passwordHash: 'no-login-fixture' } });
  const draft = await prisma.applicationDraft.create({ data: { organisationId: organisation.id, createdById: user.id, expiresAt: new Date(Date.now() + 86400000) } });
  await prisma.applicationDraftDocument.createMany({ data: Array.from({ length: 20 }, (_, index) => ({ draftId: draft.id, originalFilename: `batch-${index}.pdf`, fileName: `batch-${index}.pdf`, storageKey: `not-read-budget-fixture-${index}`, mimeType: 'application/pdf', sizeBytes: 100, sha256: String(index).padStart(64, '0'), uploadIntentKey: randomUUID(), uploadStatus: 'READY' as const })) });
  await enqueueDraftProcessing(draft.id, organisation.id);
  await enqueueDraftProcessing(draft.id, organisation.id);
  assert.equal(await prisma.documentProcessingJob.count({ where: { draftId: draft.id } }), 20, 'repeated starts reserve one job per PDF');
  const continuation = await runInlineDraftProcessing(draft.id, organisation.id, { deadline: Date.now() });
  assert.equal(continuation.mode, 'inline'); assert.equal(continuation.continueAfterMs, 1500);
  assert.equal(await prisma.documentProcessingJob.count({ where: { draftId: draft.id, state: 'WAITING', attempts: 0 } }), 20, 'an exhausted request budget returns saved work without claiming or reading another PDF');
  await prisma.documentProcessingJob.updateMany({ where: { draftId: draft.id }, data: { state: 'CANCELLED' } });
  console.log('20-PDF inline reservations, duplicate starts and exhausted request-budget continuation passed.');
} finally {
  if (previous === undefined) delete process.env.DOCUMENT_PROCESSING_ENABLED; else process.env.DOCUMENT_PROCESSING_ENABLED = previous;
  await prisma.$disconnect();
}
