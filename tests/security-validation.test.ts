import assert from 'node:assert/strict';
import { assertAllowedOrigin } from '../src/lib/server/origin-guard';
import { saveUploadedDocument } from '../src/lib/server/uploads';
import { clientSchema, deadlineSchema, planningApplicationSchema } from '../src/lib/validation/domain';
import { evidenceUrlSchema } from '../src/lib/validation/security';

const TEST_ORIGIN = 'http://localhost:4321';
const EVIL_ORIGIN = 'https://evil.example';

const assertRejectsSchema = (name: string, fn: () => unknown) => {
  assert.throws(fn, name);
};

assertRejectsSchema('external URLs reject javascript URLs', () => {
  evidenceUrlSchema.parse('javascript:alert(1)');
});

assertRejectsSchema('planning portal URLs reject data URLs', () => {
  planningApplicationSchema.parse({
    status: 'SUBMITTED',
    portalUrl: 'data:text/html,<script>alert(1)</script>',
  });
});

assertRejectsSchema('client email validation rejects malformed addresses', () => {
  clientSchema.parse({ name: 'Test Client', email: 'not-an-email' });
});

assertRejectsSchema('deadline due date is required', () => {
  deadlineSchema.parse({ title: 'Missing date', type: 'CUSTOM' });
});

assert.doesNotThrow(() => {
  assertAllowedOrigin(new Request(TEST_ORIGIN + '/api/projects', {
    method: 'POST',
    headers: { Origin: TEST_ORIGIN },
  }));
}, 'same-origin mutation should pass');

assert.throws(() => {
  assertAllowedOrigin(new Request(TEST_ORIGIN + '/api/projects', {
    method: 'POST',
    headers: { Origin: EVIL_ORIGIN },
  }));
}, 'evil origin mutation should be blocked');

const unsafeFiles = [
  new File(['<svg><script>alert(1)</script></svg>'], 'drawing.svg', { type: 'image/svg+xml' }),
  new File(['MZ'], 'drawing.exe', { type: 'application/x-msdownload' }),
  new File([new Uint8Array(26 * 1024 * 1024)], 'large.pdf', { type: 'application/pdf' }),
  new File(['safe'], '../drawing.pdf', { type: 'application/pdf' }),
];

for (const file of unsafeFiles) {
  await assert.rejects(
    () => saveUploadedDocument(file, { folder: 'test/documents', label: 'document' }),
    `unsafe upload rejected: ${file.name}`,
  );
}

console.log('security validation tests passed');
