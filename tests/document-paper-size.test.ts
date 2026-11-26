import assert from 'node:assert/strict';
import { DocumentType, AutomationJobType } from '@prisma/client';
import { PAPER_SIZES, paperSizeFromPoints, reconcilePaperSize, paperSizeFromAudit, withManualPaperSize } from '../src/lib/document-paper-size';
import { physicalPdfPaperSizes } from '../src/server/services/pdf-paper-size.service';
import { classifyProjectDocumentBatch, documentAnalysisCacheMatches, DOCUMENT_ANALYSIS_PROMPT_VERSION, DOCUMENT_ANALYSIS_SCHEMA_VERSION } from '../src/server/services/pdf-classification.service';
import { mapDocument } from '../src/server/services/automation-jobs.service';
import { agentSupportsJob } from '../src/server/services/desktop-agent.service';

const point = (mm: number) => mm * 72 / 25.4;
assert.equal(paperSizeFromPoints(point(420), point(297)), 'A3');
assert.equal(paperSizeFromPoints(point(210), point(297)), 'A4');
assert.equal(paperSizeFromPoints(123, 456), null);
const ai = { value: 'A3' as const, certainty: 'high' as const, evidence: 'Title block: Sheet size A3', page: 1, mixedSizes: false };
assert.equal(reconcilePaperSize(ai, ['A3']).value, 'A3');
assert.equal(reconcilePaperSize(ai, ['A3']).source, 'ai');
assert.equal(reconcilePaperSize(ai, ['A1']).reviewRequired, true);
assert.equal(reconcilePaperSize(ai, ['A1']).value, null);
assert.equal(reconcilePaperSize(ai, ['A3', 'A4']).reviewRequired, true);
assert.equal(reconcilePaperSize(ai, ['A3', null]).reviewRequired, true);
assert.equal(reconcilePaperSize(ai, [null]).reviewRequired, true);
assert.equal(reconcilePaperSize(null, ['A4']).value, 'A4');
assert.equal(reconcilePaperSize(null, []).reviewRequired, true);
const audit = { classification: { paperSize: reconcilePaperSize(ai, ['A1']), evidence: 'Keep this evidence' } };
assert.equal(paperSizeFromAudit(withManualPaperSize(audit, 'A1'))?.value, 'A1');
assert.equal(paperSizeFromAudit(withManualPaperSize(audit, 'A1'))?.reviewRequired, false);
assert.ok(withManualPaperSize(audit, 'A1').classification.paperSizeDetected);
assert.equal(paperSizeFromAudit({ classification: { paperSize: { value: 'invalid' } } }), null);

const blankPdf = (width: number, height: number) => {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents 4 0 R >>`,
    '<< /Length 0 >>\nstream\n\nendstream'];
  let data = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(data)); data += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(data);
  data += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size 5 >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(data);
};
const bytes = blankPdf(point(297), point(420));
assert.deepEqual(await physicalPdfPaperSizes(bytes), ['A3']);
assert.deepEqual(await physicalPdfPaperSizes(bytes), ['A3'], 'PDF parsing must not mutate the original bytes');
const suggestions = await classifyProjectDocumentBatch([{ filename: 'GA100.pdf', mimeType: 'application/pdf', bytes }], {},
  { name: 'test-ai', model: 'test-model', classifyDocument: async () => ({
    categoryKey: 'proposed_plans', certainty: 'high', paperSize: ai, manualReviewRequired: false,
    warnings: [], extractedFacts: [], existingOrProposed: 'proposed', mixedDocumentDetected: false,
  }) });
assert.equal(suggestions[0].classificationDetails?.paperSize?.value, 'A3');
const document = { id: 'doc', originalName: 'GA100.pdf', fileName: 'GA100.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length,
  fileHash: 'a'.repeat(64), type: DocumentType.PROPOSED_DRAWING, drawingTitle: null, drawingNumber: null, revision: null,
  sortSource: 'AI', sortConfidence: 1, status: 'APPROVED', updatedAt: new Date(),
  analysisResult: { classification: { paperSize: suggestions[0].classificationDetails?.paperSize } } };
assert.equal(mapDocument(document as any).paperSize?.value, 'A3');
assert.equal(mapDocument(document as any).fileHash, 'a'.repeat(64));
assert.equal(documentAnalysisCacheMatches({ fileHash: 'hash', analysisVersion: 'document-intelligence-v2', analysisStatus: 'SUCCESS',
  analysisSchemaVersion: 'document-intelligence-schema-v4', analysisPromptVersion: 'document-intelligence-prompt-v5' }, 'hash'), false);
assert.ok(DOCUMENT_ANALYSIS_SCHEMA_VERSION.endsWith('v5') && DOCUMENT_ANALYSIS_PROMPT_VERSION.endsWith('v6'));
const capabilities = { workflows: [AutomationJobType.BUILDING_WARRANT], snapshotVersions: [2], callbackContractVersions: [1], progressContractVersions: [1] };
const job = { type: AutomationJobType.BUILDING_WARRANT, payloadVersion: 2, dataSnapshot: { metadata: { documentUploadContractVersion: 1 } } };
assert.equal(agentSupportsJob({ capabilities }, job), false);
assert.equal(agentSupportsJob({ capabilities: { ...capabilities, documentUploadContractVersions: [1] } }, job), true);
assert.equal(PAPER_SIZES.length, 8);
console.log('AI paper size, physical dimensions, conflict review, snapshot transport, cache invalidation and Agent compatibility passed.');
