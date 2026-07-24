import assert from 'node:assert/strict';
import { assertAllowedOrigin } from '../src/lib/server/origin-guard';
import { cacheHeaders, privateApiNoStore, privateNoStore, publicPageShort } from '../src/lib/server/cache-control';
import { saveUploadedDocument } from '../src/lib/server/uploads';
import { TYPE_OF_WORK_OPTIONS } from '../src/lib/projects/type-of-work';
import { clientSchema, deadlineSchema, planningApplicationSchema, projectCreateSchema, projectSchema } from '../src/lib/validation/domain';
import { evidenceUrlSchema } from '../src/lib/validation/security';
import { jsonResponse } from '../src/lib/utils/http';

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

const normalisedClient = clientSchema.parse({
  name: 'Test Client',
  email: '  CLIENT@Example.COM  ',
  phone: '07483 882299',
});
assert.equal(normalisedClient.email, 'client@example.com', 'client emails are trimmed and lower-cased');

for (const phone of ['07483 882299', '07483882299', '+44 7483 882299', '0141 123 4567']) {
  assert.doesNotThrow(
    () => clientSchema.parse({ name: 'Valid phone', phone }),
    `valid UK phone is accepted: ${phone}`,
  );
}

for (const phone of ['123', 'phone123', '07483abc229', '999999999999999999999']) {
  assertRejectsSchema(`invalid UK phone is rejected: ${phone}`, () => {
    clientSchema.parse({ name: 'Invalid phone', phone });
  });
}

const invalidPhone = clientSchema.safeParse({ name: 'Invalid phone', phone: 'phone123' });
assert.equal(invalidPhone.success, false);
if (!invalidPhone.success) {
  assert.equal(
    invalidPhone.error.flatten().fieldErrors.phone?.[0],
    'Enter a valid phone number.',
    'client phone validation returns a safe user-facing message',
  );
}

const minimalProject = projectCreateSchema.parse({ name: 'Minimal project' });
assert.equal(minimalProject.stage, 'LEAD', 'new projects default to lead stage server-side');
assert.equal(minimalProject.status, 'ACTIVE', 'new projects default to active status server-side');
assert.equal(minimalProject.siteAddress, undefined, 'new projects do not require a manual site address');
assert.equal(minimalProject.clientId, undefined, 'new projects can be created without a client');
assert.equal(minimalProject.siteId, undefined, 'new projects can be created without a site');

for (const projectType of TYPE_OF_WORK_OPTIONS) {
  assert.equal(
    projectCreateSchema.parse({ name: 'Typed project', projectType }).projectType,
    projectType,
    `type of work is accepted: ${projectType}`,
  );
}

assertRejectsSchema('new project type rejects unsupported free text', () => {
  projectCreateSchema.parse({ name: 'Unsupported type', projectType: 'Racing paddock' });
});

assert.equal(
  projectSchema.parse({ name: 'Existing project', projectType: 'Legacy custom type', siteAddress: 'Existing address' }).projectType,
  'Legacy custom type',
  'existing project validation preserves legacy project type values',
);

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

assert.match(privateNoStore, /private/);
assert.match(privateNoStore, /no-store/);
assert.match(privateApiNoStore, /private/);
assert.match(privateApiNoStore, /no-store/);
assert.match(publicPageShort, /must-revalidate/);
assert.equal(cacheHeaders.PRIVATE_NO_STORE, privateNoStore);
assert.equal(jsonResponse(200, { ok: true }).headers.get('Cache-Control'), privateApiNoStore);

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
