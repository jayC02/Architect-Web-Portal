import assert from 'node:assert/strict';
import { DocumentType } from '@prisma/client';
import { documentSortBatchAcceptSchema, documentMetadataSchema } from '../src/lib/validation/domain';
import { classifyDocumentBatch } from '../src/server/services/document-sorter.service';

const [locationPlan, sitePlan] = await classifyDocumentBatch([
  {
    filename: '2301 Location Plan P01.pdf',
    mimeType: 'application/pdf',
    pdfText: 'Drawing Title: Site Location Plan\nOrdnance Survey extract\nRev P01',
  },
  {
    filename: '2301 Site Plan P01.pdf',
    mimeType: 'application/pdf',
    pdfText: 'Drawing Title: Proposed Site Plan\nRev P01',
  },
]);

assert.equal(locationPlan.suggestedDocumentType, DocumentType.LOCATION_PLAN);
assert.equal(sitePlan.suggestedDocumentType, DocumentType.SITE_PLAN);
assert.ok(locationPlan.confidence >= 0.8);
assert.equal(locationPlan.revision, 'P01');

const [fallbackPlan] = await classifyDocumentBatch([
  {
    filename: '2301 Block Plan Rev A.pdf',
    mimeType: 'application/pdf',
    pdfText: 'Drawing Title: Block Plan\nRevision A',
  },
]);

assert.equal(fallbackPlan.suggestedDocumentType, DocumentType.LOCATION_PLAN);
assert.ok(fallbackPlan.reason.includes('fallback'));
assert.ok(fallbackPlan.confidence < 0.8);

const [lowConfidence] = await classifyDocumentBatch([
  {
    filename: 'misc-upload.pdf',
    mimeType: 'application/pdf',
    pdfText: 'Unlabelled project notes',
  },
]);

assert.equal(lowConfidence.suggestedDocumentType, DocumentType.OTHER);
assert.ok(lowConfidence.confidence < 0.55);
assert.ok(lowConfidence.reason.includes('manual review'));

assert.throws(() => {
  documentSortBatchAcceptSchema.parse({
    items: [{
      itemId: 'item-1',
      documentType: 'RACING_TELEMETRY',
      status: 'IN_REVIEW',
    }],
  });
}, 'invalid document types are rejected for accepted batches');

assert.doesNotThrow(() => {
  documentMetadataSchema.parse({
    type: DocumentType.SITE_PLAN,
    revision: 'P02',
    status: 'APPROVED',
    notes: 'Manual classification still works.',
  });
}, 'existing manual document classification remains valid');

console.log('document sorter tests passed');
