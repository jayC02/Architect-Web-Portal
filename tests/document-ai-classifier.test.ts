import assert from 'node:assert/strict';
import { DocumentSortSource, DocumentType } from '@prisma/client';
import {
  analysisStatusForSuggestion,
  buildGeminiGenerateContentRequest,
  classifyProjectDocumentBatch,
  GEMINI_DOCUMENT_RESPONSE_SCHEMA,
  geminiDocumentGenerationConfig,
  pdfClassificationResultSchema,
  PdfAiProcessingError,
  validateGeminiPdfInput,
  validateGeminiResponseSchema,
  type PdfClassificationProvider,
  type PdfClassificationResult,
} from '../src/server/services/pdf-classification.service';

assert.ok(
  !JSON.stringify(GEMINI_DOCUMENT_RESPONSE_SCHEMA).includes('additionalProperties'),
  'Gemini response schema must only use keywords accepted by the Gemini API',
);
assert.ok(
  !JSON.stringify(GEMINI_DOCUMENT_RESPONSE_SCHEMA).includes('"maxItems":60'),
  'Gemini must not receive the extracted-fact limit that exceeds this model schema complexity budget',
);
assert.doesNotThrow(() => validateGeminiResponseSchema(GEMINI_DOCUMENT_RESPONSE_SCHEMA));
assert.throws(
  () => validateGeminiResponseSchema({ type: 'object', $ref: '#/$defs/result' }),
  /unsupported keyword/,
);
let deeplyNestedSchema: Record<string, unknown> = { type: 'string' };
for (let level = 0; level < 14; level += 1) {
  deeplyNestedSchema = { type: 'object', properties: { child: deeplyNestedSchema } };
}
assert.throws(() => validateGeminiResponseSchema(deeplyNestedSchema), /deeply nested/);
assert.throws(
  () => validateGeminiResponseSchema({ type: 'object', description: 'x'.repeat(13_000) }),
  /complexity limit/,
);
const geminiGenerationConfig = geminiDocumentGenerationConfig();
assert.equal(geminiGenerationConfig.responseMimeType, 'application/json');
assert.equal(geminiGenerationConfig.responseJsonSchema, GEMINI_DOCUMENT_RESPONSE_SCHEMA);
assert.ok(
  !('responseSchema' in geminiGenerationConfig),
  'Gemini must receive full JSON Schema through responseJsonSchema, not the legacy protobuf schema field',
);

const input = (filename: string) => ({
  filename,
  mimeType: 'application/pdf',
  bytes: Buffer.from('%PDF-1.4 test document'),
  pdfText: '',
});

const validPdf = Buffer.from('%PDF-1.4 test document');
assert.deepEqual(validateGeminiPdfInput({ mimeType: 'application/pdf', bytes: validPdf }).signature, '%PDF-');
assert.throws(
  () => validateGeminiPdfInput({ mimeType: 'text/html', bytes: Buffer.from('<html>error</html>') }),
  /not a PDF/,
);
assert.throws(
  () => validateGeminiPdfInput({ mimeType: 'application/pdf', bytes: Buffer.from('<html>storage error</html>') }),
  /contains HTML/,
);
assert.throws(
  () => validateGeminiPdfInput({ mimeType: 'application/pdf', bytes: Buffer.from('JVBERi0xLjQ=') }),
  /encoded more than once/,
);
assert.throws(
  () => validateGeminiPdfInput({ mimeType: 'application/pdf', bytes: Buffer.alloc(0) }),
  /empty/,
);

const geminiRequest = buildGeminiGenerateContentRequest({
  filename: 'test.pdf',
  fileReference: 'test-document',
  mimeType: 'application/pdf',
  bytes: validPdf,
});
const inlinePart = geminiRequest.body.contents[0].parts[0];
assert.ok('inlineData' in inlinePart);
assert.equal(inlinePart.inlineData?.mimeType, 'application/pdf');
assert.ok(inlinePart.inlineData?.data.startsWith('JVBERi0'));
assert.equal(geminiRequest.diagnostics.requestMode, 'generateContent');
assert.equal(geminiRequest.diagnostics.apiVersion, 'v1beta');
assert.ok(!JSON.stringify(geminiRequest.body).includes('x-goog-api-key'));
assert.ok(!JSON.stringify(geminiRequest.body).includes('data:application/pdf'));
assert.ok(!JSON.stringify(geminiRequest.body).includes('"type":"document"'));
assert.ok(!JSON.stringify(geminiRequest.body).includes('"mime_type"'));

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
assert.equal(fallback.classificationDetails?.aiStatus, 'invalid_response');
assert.equal(analysisStatusForSuggestion(fallback), 'INVALID_RESPONSE');
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
assert.equal(timedOut.classificationDetails?.aiStatus, 'provider_unavailable');
assert.equal(analysisStatusForSuggestion(timedOut), 'PROVIDER_UNAVAILABLE');

const [invalidRequest] = await classifyProjectDocumentBatch(
  [input('invalid-request.pdf')],
  {},
  {
    name: 'invalid-request-provider',
    model: 'test-model',
    async classifyDocument() {
      throw new PdfAiProcessingError('invalid_request', 'The AI request format was rejected.', 400, 'INVALID_ARGUMENT');
    },
  },
);
assert.equal(invalidRequest.classificationDetails?.aiStatus, 'invalid_request');
assert.equal(invalidRequest.classificationDetails?.providerHttpStatus, 400);
assert.equal(invalidRequest.classificationDetails?.providerStatus, 'INVALID_ARGUMENT');
assert.equal(analysisStatusForSuggestion(invalidRequest), 'INVALID_REQUEST');

const duplicateLocations = await classifyProjectDocumentBatch(
  [input('location-a.pdf'), input('location-b.pdf')],
  {},
  provider(validResult('location_plan')),
);
assert.ok(duplicateLocations.every((item) => item.classificationDetails?.manualReviewRequired));
assert.ok(duplicateLocations.every((item) =>
  item.classificationDetails?.warnings.some((warning) => warning.includes('More than one document'))));

console.log('AI document classifier tests passed');
