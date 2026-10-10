import assert from 'node:assert/strict';
import { classifyProjectDocumentBatch, createConfiguredPdfClassificationProvider, GeminiPdfClassificationProvider } from '../src/server/services/pdf-classification.service';

const originalFetch = globalThis.fetch;
const originalProvider = process.env.DOCUMENT_AI_PROVIDER;
const originalKey = process.env.OPENAI_API_KEY;
const input = [{ documentId: 'timeout-fixture', filename: 'Location Plan.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.4\nSynthetic timeout fixture\n%%EOF') }];
try {
  let aborted = false;
  globalThis.fetch = async (_url, options) => new Promise<Response>((_resolve, reject) => {
    const signal = options?.signal;
    assert.ok(signal, 'provider requests must receive the overall operation deadline');
    const fail = () => { aborted = true; reject(signal.reason); };
    if (signal.aborted) fail(); else signal.addEventListener('abort', fail, { once: true });
  });
  const started = Date.now();
  const [timedOut] = await classifyProjectDocumentBatch(input, {}, new GeminiPdfClassificationProvider('test-key'), undefined, AbortSignal.timeout(20));
  assert.equal(aborted, true);
  assert.equal(timedOut.classificationDetails?.aiStatus, 'provider_unavailable');
  assert.ok(Date.now() - started < 1000, 'the operation deadline overrides a longer provider timeout');
  process.env.DOCUMENT_AI_PROVIDER = 'openai'; process.env.OPENAI_API_KEY = 'test-key';
  globalThis.fetch = async () => Response.json({ error: 'Synthetic outage' }, { status: 503 });
  const [unavailable] = await classifyProjectDocumentBatch(input, {}, createConfiguredPdfClassificationProvider());
  assert.equal(unavailable.classificationDetails?.aiStatus, 'provider_unavailable');
  assert.equal(unavailable.classificationDetails?.providerHttpStatus, 503, 'a transient OpenAI outage remains retryable');
} finally {
  globalThis.fetch = originalFetch;
  if (originalProvider === undefined) delete process.env.DOCUMENT_AI_PROVIDER; else process.env.DOCUMENT_AI_PROVIDER = originalProvider;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
}
console.log('Document operation deadline and retryable provider status checks passed.');
