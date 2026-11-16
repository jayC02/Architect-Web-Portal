import assert from 'node:assert/strict';
import { DocumentSortSource, DocumentType } from '@prisma/client';
import {
  analysisStatusForSuggestion,
  buildClaudeMessagesRequest,
  buildGeminiGenerateContentRequest,
  CLAUDE_DOCUMENT_RESPONSE_SCHEMA,
  ClaudePdfClassificationProvider,
  classifyProjectDocumentBatch,
  createConfiguredPdfClassificationProvider,
  GEMINI_DOCUMENT_RESPONSE_SCHEMA,
  GeminiPdfClassificationProvider,
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
  fileReference: filename,
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

const validGeminiWireResult = (categoryKey: PdfClassificationResult['categoryKey']) => ({
  categoryKey,
  certainty: 'high',
  detectedTitle: null,
  drawingNumber: null,
  revision: null,
  pageCount: 1,
  existingOrProposed: 'unknown',
  extractedFacts: [],
  evidence: `Visible title block identifies ${categoryKey}.`,
  manualReviewRequired: false,
  warnings: [],
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

let activeRequests = 0;
let maximumActiveRequests = 0;
let progressUpdates = 0;
await classifyProjectDocumentBatch(
  Array.from({ length: 6 }, (_, index) => input(`concurrency-${index}.pdf`)),
  {},
  {
    name: 'concurrency-provider',
    model: 'test-model',
    async classifyDocument() {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeRequests -= 1;
      return validResult('supporting_documents');
    },
  },
  async () => {
    progressUpdates += 1;
  },
);
assert.equal(maximumActiveRequests, 2, 'document AI requests are bounded to two concurrent calls');
assert.equal(progressUpdates, 6, 'each completed file reports progress independently');

const originalFetch = globalThis.fetch;
const originalRetries = process.env.DOCUMENT_AI_MAX_RETRIES;
const originalRetryBase = process.env.DOCUMENT_AI_RETRY_BASE_MS;
try {
  process.env.DOCUMENT_AI_MAX_RETRIES = '1';
  process.env.DOCUMENT_AI_RETRY_BASE_MS = '50';
  let transientCalls = 0;
  globalThis.fetch = (async () => {
    transientCalls += 1;
    if (transientCalls === 1) {
      return new Response(JSON.stringify({
        error: { message: 'Rate limit reached.', status: 'RESOURCE_EXHAUSTED' },
      }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '0' },
      });
    }
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify(validGeminiWireResult('location_plan')) }],
        },
      }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const retried = await new GeminiPdfClassificationProvider(
    'test-key',
    'gemini-3.5-flash-lite',
  ).classifyDocument(input('retry.pdf'));
  assert.equal(retried.categoryKey, 'location_plan');
  assert.equal(transientCalls, 2, '429 responses retry once and respect the capped retry loop');

  let invalidCalls = 0;
  globalThis.fetch = (async () => {
    invalidCalls += 1;
    return new Response(JSON.stringify({
      error: { message: 'Invalid JSON payload.', status: 'INVALID_ARGUMENT' },
    }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  await assert.rejects(
    () => new GeminiPdfClassificationProvider(
      'test-key',
      'gemini-3.5-flash-lite',
    ).classifyDocument(input('invalid.pdf')),
    (error: unknown) =>
      error instanceof PdfAiProcessingError
      && error.aiStatus === 'invalid_request',
    'invalid schema requests fail immediately and use fallback upstream',
  );
  assert.equal(invalidCalls, 1, 'invalid requests are not retried');
} finally {
  globalThis.fetch = originalFetch;
  if (originalRetries === undefined) delete process.env.DOCUMENT_AI_MAX_RETRIES;
  else process.env.DOCUMENT_AI_MAX_RETRIES = originalRetries;
  if (originalRetryBase === undefined) delete process.env.DOCUMENT_AI_RETRY_BASE_MS;
  else process.env.DOCUMENT_AI_RETRY_BASE_MS = originalRetryBase;
}

// Claude (Anthropic Messages API)
{
  type SchemaNode = { type?: unknown; additionalProperties?: unknown; properties?: Record<string, SchemaNode>; items?: SchemaNode; required?: string[] };
  const objects: SchemaNode[] = [];
  let unionTypes = 0;
  let optionalProperties = 0;
  const walk = (node: SchemaNode) => {
    if (Array.isArray(node.type)) unionTypes += 1;
    if (node.type === 'object') {
      objects.push(node);
      const keys = Object.keys(node.properties ?? {});
      optionalProperties += keys.filter((key) => !(node.required ?? []).includes(key)).length;
    }
    Object.values(node.properties ?? {}).forEach(walk);
    if (node.items) walk(node.items);
  };
  walk(CLAUDE_DOCUMENT_RESPONSE_SCHEMA as SchemaNode);
  assert.ok(objects.length >= 2);
  assert.ok(objects.every((node) => node.additionalProperties === false), 'Claude needs additionalProperties: false on every object');
  assert.ok(unionTypes <= 16, 'Claude allows at most 16 union-typed parameters');
  assert.ok(optionalProperties <= 24, 'Claude allows at most 24 optional parameters');
  assert.ok(
    !JSON.stringify(GEMINI_DOCUMENT_RESPONSE_SCHEMA).includes('additionalProperties'),
    'building the Claude schema must not change the Gemini schema',
  );

  const request = buildClaudeMessagesRequest(input('claude.pdf'), 'claude-haiku-5-5');
  const [documentBlock, textBlock] = request.body.messages[0].content;
  assert.equal(documentBlock.type, 'document');
  assert.ok('source' in documentBlock);
  assert.equal(documentBlock.source.type, 'base64');
  assert.equal(documentBlock.source.media_type, 'application/pdf');
  assert.ok(documentBlock.source.data.startsWith('JVBERi0'));
  assert.equal(textBlock.type, 'text');
  assert.equal(request.body.output_config.format.type, 'json_schema');
  assert.equal(request.body.output_config.effort, 'medium');
  assert.ok(!('temperature' in request.body), 'temperature is rejected by the current API version');

  const originalEnv = {
    provider: process.env.DOCUMENT_AI_PROVIDER,
    key: process.env.ANTHROPIC_API_KEY,
    retries: process.env.DOCUMENT_AI_MAX_RETRIES,
    retryBase: process.env.DOCUMENT_AI_RETRY_BASE_MS,
  };
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  try {
    process.env.DOCUMENT_AI_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    const configured = createConfiguredPdfClassificationProvider();
    assert.equal(configured?.name, 'anthropic');
    assert.equal(configured?.model, 'claude-haiku-5-5');
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(createConfiguredPdfClassificationProvider(), null, 'no key means deterministic sorting');

    process.env.DOCUMENT_AI_MAX_RETRIES = '1';
    process.env.DOCUMENT_AI_RETRY_BASE_MS = '50';
    const claudeReply = (body: unknown, stopReason = 'end_turn') => new Response(JSON.stringify({
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(body) }],
      stop_reason: stopReason,
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    let calls = 0;
    const seenHeaders: Record<string, string>[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      seenHeaders.push(init?.headers as Record<string, string>);
      if (calls === 1) {
        return new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'Rate limited.' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '0' },
        });
      }
      // Claude may vary enum capitalisation.
      return claudeReply({ ...validGeminiWireResult('location_plan'), categoryKey: 'Location_plan', certainty: 'High' });
    }) as typeof fetch;
    const claudeResult = await new ClaudePdfClassificationProvider('test-anthropic-key', 'claude-haiku-5-5')
      .classifyDocument(input('claude-retry.pdf'));
    assert.equal(claudeResult.categoryKey, 'location_plan');
    assert.equal(claudeResult.certainty, 'high');
    assert.equal(calls, 2, 'a 429 is retried');
    assert.equal(seenHeaders[0]['x-api-key'], 'test-anthropic-key');
    assert.equal(seenHeaders[0]['anthropic-version'], '2026-10-21');

    calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({
        type: 'error',
        error: { type: 'rate_limit_error', message: 'Monthly limit reached.', details: { error_code: 'enforced_spend_limit_reached' } },
      }), { status: 429, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    await assert.rejects(
      () => new ClaudePdfClassificationProvider('test-anthropic-key').classifyDocument(input('spend-cap.pdf')),
      (error: unknown) => error instanceof PdfAiProcessingError
        && error.aiStatus === 'provider_unavailable'
        && error.providerStatus === 'enforced_spend_limit_reached',
    );
    assert.equal(calls, 1, 'the spend-cap 429 is not retried');

    globalThis.fetch = (async () => claudeReply({ categoryKey: 'location_plan' }, 'max_tokens')) as typeof fetch;
    await assert.rejects(
      () => new ClaudePdfClassificationProvider('test-anthropic-key').classifyDocument(input('cut-off.pdf')),
      (error: unknown) => error instanceof PdfAiProcessingError && error.aiStatus === 'invalid_response',
      'a truncated answer is rejected',
    );

    globalThis.fetch = (async () => claudeReply(validGeminiWireResult('sections'))) as typeof fetch;
    const [viaBatch] = await classifyProjectDocumentBatch(
      [input('section.pdf')],
      {},
      new ClaudePdfClassificationProvider('test-anthropic-key'),
    );
    assert.equal(viaBatch.source, DocumentSortSource.AI);
    assert.equal(viaBatch.suggestedDocumentType, DocumentType.SECTION);
    assert.equal(viaBatch.classificationDetails?.provider, 'anthropic');
    assert.equal(viaBatch.classificationDetails?.model, 'claude-haiku-5-5');
  } finally {
    globalThis.fetch = originalFetch;
    restore('DOCUMENT_AI_PROVIDER', originalEnv.provider);
    restore('ANTHROPIC_API_KEY', originalEnv.key);
    restore('DOCUMENT_AI_MAX_RETRIES', originalEnv.retries);
    restore('DOCUMENT_AI_RETRY_BASE_MS', originalEnv.retryBase);
  }
}

console.log('AI document classifier tests passed');
