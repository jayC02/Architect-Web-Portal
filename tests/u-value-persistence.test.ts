import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import * as calculator from '../src/lib/u-value/calculator';
import { HttpError, jsonResponse } from '../src/lib/utils/http';
import { withErrorHandling } from '../src/lib/utils/handlers';
import { assertAllowedOrigin } from '../src/lib/server/origin-guard';

const load = (file: string, modules: Record<string, unknown>) => {
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, console, require: (name: string) => {
    assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name];
  } });
  return exports;
};
const rows: any[] = [];
const matches = (row: any, where: any) => Object.entries(where).every(([key, value]) => row[key] === value);
const database: any = {
  uValueCalculation: {
    findUnique: async ({ where }: any) => rows.find(row => matches(row, where)) ?? null,
    findFirst: async ({ where }: any) => rows.find(row => matches(row, where)) ?? null,
    findMany: async ({ where, select }: any) => rows.filter(row => matches(row, where)).map(row =>
      Object.fromEntries(Object.keys(select).map(key => [key, row[key]]))),
    create: async ({ data }: any) => {
      if (rows.some(row => row.idempotencyKey === data.idempotencyKey)) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      const row = { ...structuredClone(data), id: `calculation-${rows.length + 1}`, createdAt: new Date() };
      rows.push(row); return row;
    },
  },
  project: { findFirst: async ({ where }: any) => where.id === 'owned' && where.organisationId === 'org'
    ? { id: 'owned', name: 'Owned project', internalReference: 'W01', siteAddress: 'Test site' } : null },
  $transaction: async (fn: any) => fn(database),
};
const modules: Record<string, unknown> = {
  'node:crypto': { createHash }, zod: { z }, '@/lib/db/prisma': { prisma: database },
  '@/lib/utils/http': { HttpError, jsonResponse }, '@/lib/u-value/calculator': calculator,
};
const { saveUValueCalculation, saveUValueSchema } = load('src/server/services/u-value.service.ts', modules);
const input = { element: 'wall', correctionsAssessed: true, layers: [{ id: 'pir', kind: 'solid', name: 'Referenced insulation', thicknessMm: 100, lambda: 0.04, source: 'Material test declaration' }] };
const body = { requestId: '11111111-1111-4111-8111-111111111111', title: 'External wall', projectId: 'owned', inputs: input };
const scope = { organisationId: 'org', organisationName: 'Practice', userId: 'user', userName: 'Architect', database };
const save = (values: object = {}, owner: object = {}) => saveUValueCalculation({ ...scope, ...owner, body: { ...body, ...values } });

const first = await save();
assert.equal(first.contextSnapshot.projectName, 'Owned project');
assert.equal(first.contextSnapshot.reference, 'W01');
assert.equal(first.contextSnapshot.location, 'Test site');
assert.equal(first.contextSnapshot.preparedBy, 'Architect');
assert.equal(first.resultSnapshot.uValue, 1 / 2.67);
assert.equal(first.inputHash.length, 64);
assert.equal((await save()).id, first.id);
assert.equal(rows.length, 1, 'retry returns the original immutable report');
await assert.rejects(save({ title: 'Changed inputs under same request' }), /different inputs/);
await assert.rejects(save({ requestId: '22222222-2222-4222-8222-222222222222', projectId: 'foreign' }), /Project not found/);
await assert.rejects(save({ inputs: { ...input, correctionsAssessed: false } }), /corrections have been assessed/);
await assert.rejects(save({ inputs: { ...input, layers: [{ ...input.layers[0], source: '' }] } }), /design-value references/);
assert.throws(() => saveUValueSchema.parse({ ...body, organisationId: 'other', resultSnapshot: { uValue: 0.01 } }));
const second = await save({ requestId: '33333333-3333-4333-8333-333333333333', inputs: { ...input, layers: [{ ...input.layers[0], thicknessMm: 150 }] } });
assert.notEqual(second.id, first.id); assert.equal(first.inputSnapshot.layers[0].thicknessMm, 100);
assert.equal(first.resultSnapshot.uValue, 1 / 2.67, 'editing a copy does not recalculate the issued report');
const calculated = await save({ requestId: '66666666-6666-4666-8666-666666666666', inputs: { ...input,
  automaticCorrections: [{ kind: 'airgap', layerId: 'pir', level: 1, source: 'Assessed installation: through gaps without circulation' }] } });
assert.equal(calculated.resultSnapshot.engineVersion, '4.0.0');
assert.equal(calculated.resultSnapshot.correctionDetails.length, 1);
assert.ok(calculated.resultSnapshot.uValue > calculated.resultSnapshot.baseUValue);

const retryBody = { requestId: '44444444-4444-4444-8444-444444444444', projectId: null };
const concurrent = await Promise.all([save(retryBody), save(retryBody)]);
assert.equal(concurrent[0].id, concurrent[1].id, 'concurrent duplicate inserts resolve after rollback');
const divergent = await Promise.allSettled([
  save({ requestId: '55555555-5555-4555-8555-555555555555', projectId: null, title: 'A' }),
  save({ requestId: '55555555-5555-4555-8555-555555555555', projectId: null, title: 'B' }),
]);
assert.equal(divergent.filter(result => result.status === 'fulfilled').length, 1);
assert.equal((divergent.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.status, 409);
const foreign = await save({ projectId: null }, { organisationId: 'other', organisationName: 'Other practice' });
assert.notEqual(foreign.id, first.id, 'request IDs are scoped to the authenticated organisation');

let organisationId = 'org', signedIn = true;
Object.assign(modules, {
  '@/lib/server/origin-guard': { assertAllowedOrigin },
  '@/lib/server/rate-limit': { assertRateLimit: () => {}, rateLimitPolicies: { mutation: {} } },
  '@/lib/utils/handlers': { withErrorHandling },
  '@/server/permissions/authz': { requireOrganisation: async () => {
    if (!signedIn) throw new HttpError(401, 'Sign in required.');
    return { organisation: { id: organisationId, name: 'Practice' }, user: { id: 'user', name: 'Architect' } };
  } },
  '@/server/services/u-value.service': { saveUValueCalculation },
});
const route = load('src/pages/api/u-value/index.ts', modules);
const detail = load('src/pages/api/u-value/[id].ts', modules).GET;
const context = (id = first.id, request = new Request('https://portal.test/api/u-value')) => ({ params: { id }, request, url: new URL(request.url) });
let response = await route.GET(context()); assert.equal(response.status, 200);
assert.ok((await response.json()).calculations.every((row: any) => row.id !== foreign.id));
response = await detail(context(foreign.id)); assert.equal(response.status, 404);
response = await detail(context()); assert.equal(response.status, 200);
assert.match(response.headers.get('Cache-Control')!, /private, no-store/);
organisationId = 'other'; response = await detail(context()); assert.equal(response.status, 404);
signedIn = false; assert.equal((await route.GET(context())).status, 401); assert.equal((await detail(context())).status, 401);
signedIn = true; organisationId = 'org';
response = await route.POST(context('', new Request('https://portal.test/api/u-value', { method: 'POST', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })));
assert.equal(response.status, 403);
response = await route.POST(context('', new Request('https://portal.test/api/u-value', { method: 'POST', headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })));
assert.equal(response.status, 201); assert.equal((await response.json()).calculation.id, first.id);
for (const file of ['src/pages/tools/u-value/index.astro', 'src/pages/tools/u-value/reports/[id].astro']) {
  const source = fs.readFileSync(file, 'utf8'); assert.ok(source.includes('requirePageAuth')); assert.ok(source.includes('organisationId: auth.organisation.id'));
}
console.log('PASS saved snapshots, authenticated organisation ownership, source/assessment validation, idempotent retries, concurrent saves, CSRF and private report access.');
