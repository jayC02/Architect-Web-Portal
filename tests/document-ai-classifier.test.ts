import assert from 'node:assert/strict';
import { DocumentSortSource, DocumentType } from '@prisma/client';
import {
  classifyProjectDocumentBatch,
  pdfClassificationResultSchema,
  type PdfClassificationProvider,
  type PdfClassificationResult,
} from '../src/server/services/pdf-classification.service';

const input = (filename: string) => ({
  filename,
  mimeType: 'application/pdf',
  bytes: Buffer.from('%PDF-1.4 test document'),
  pdfText: '',
});

const provider = (result: PdfClassificationResult): PdfClassificationProvider => ({
  name: 'test-provider',
  model: 'test-model',
  async classifyDocument() {
    return result;
  },
});

const validResult = (categoryKey: PdfClassificationResult['categoryKey']): PdfClassificationResult => ({
  categoryKey,
  certainty: 'high',
  evidence: `Visible title block identifies ${categoryKey}.`,
  manualReviewRequired: false,
  warnings: [],
  existingOrProposed: 'unknown',
  extractedFacts: [],
  mixedDocumentDetected: false,
});

assert.doesNotThrow(() => pdfClassificationResultSchema.parse(validResult('location_plan')));
assert.throws(
  () => pdfClassificationResultSchema.parse({ ...validResult('location_plan'), categoryKey: 'invented_category' }),
  'unsupported AI categories are rejected',
);
assert.throws(
  () => pdfClassificationResultSchema.parse({ categoryKey: 'location_plan' }),
  'malformed AI output is rejected',
);

const [malformedFallback] = await classifyProjectDocumentBatch(
  [input('malformed.pdf')],
  {},
  {
    name: 'malformed-provider',
    model: 'test-model',
    async classifyDocument() {
      return { categoryKey: 'invented_category' } as unknown as PdfClassificationResult;
    },
  },
);
assert.notEqual(malformedFallback.source, DocumentSortSource.AI, 'malformed provider output uses fallback');

for (const [categoryKey, expectedType] of [
  ['location_plan', DocumentType.LOCATION_PLAN],
  ['existing_plans', DocumentType.EXISTING_DRAWING],
  ['proposed_plans', DocumentType.PROPOSED_DRAWING],
  ['sections', DocumentType.SECTION],
  ['specifications', DocumentType.SPECIFICATIONS],
  ['calculations', DocumentType.CALCULATIONS],
] as const) {
  const [suggestion] = await classifyProjectDocumentBatch(
    [input(`${categoryKey}.pdf`)],
    { projectName: 'Test project' },
    provider(validResult(categoryKey)),
  );
  assert.equal(suggestion.suggestedDocumentType, expectedType);
  assert.equal(suggestion.source, DocumentSortSource.AI);
}

const [unsure] = await classifyProjectDocumentBatch(
  [input('unclear.pdf')],
  {},
  provider({ ...validResult('unsure'), certainty: 'low', manualReviewRequired: true }),
);
assert.equal(unsure.suggestedDocumentType, DocumentType.OTHER);
assert.equal(unsure.classificationDetails?.manualReviewRequired, true);

const [mixed] = await classifyProjectDocumentBatch(
  [input('mixed.pdf')],
  {},
  provider({
    ...validResult('supporting_documents'),
    warnings: ['This PDF contains mixed document types.'],
    manualReviewRequired: true,
  }),
);
assert.equal(mixed.classificationDetails?.manualReviewRequired, true);

const failingProvider: PdfClassificationProvider = {
  name: 'failing-provider',
  model: 'test-model',
  async classifyDocument() {
    throw new Error('provider unavailable');
  },
};
const [fallback, successful] = await classifyProjectDocumentBatch(
  [
    { ...input('Location Plan.pdf'), pdfText: 'Drawing title: Location Plan' },
    input('Proposed Plans.pdf'),
  ],
  {},
  {
    name: 'partial-provider',
    model: 'test-model',
    async classifyDocument(value) {
      if (value.filename === 'Location Plan.pdf') return failingProvider.classifyDocument(value);
      return validResult('proposed_plans');
    },
  },
);
assert.notEqual(fallback.source, DocumentSortSource.AI, 'provider failure uses the deterministic fallback');
assert.equal(fallback.classificationDetails?.manualReviewRequired, true);
assert.equal(successful.source, DocumentSortSource.AI, 'one failed file does not break successful files');

const [timedOut] = await classifyProjectDocumentBatch(
  [input('timeout.pdf')],
  {},
  {
    name: 'timeout-provider',
    model: 'test-model',
    async classifyDocument() {
      throw new DOMException('timed out', 'TimeoutError');
    },
  },
);
assert.notEqual(timedOut.source, DocumentSortSource.AI);
assert.match(timedOut.classificationDetails?.fallbackReason ?? '', /timed out/i);

const duplicateLocations = await classifyProjectDocumentBatch(
  [input('location-a.pdf'), input('location-b.pdf')],
  {},
  provider(validResult('location_plan')),
);
assert.ok(duplicateLocations.every((item) => item.classificationDetails?.manualReviewRequired));
assert.ok(duplicateLocations.every((item) =>
  item.classificationDetails?.warnings.some((warning) => warning.includes('More than one document'))));

console.log('AI document classifier tests passed');
