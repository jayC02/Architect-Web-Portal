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
import { latestCalculations } from '../src/lib/u-value/revisions';
const rows: any[] = [], events: any[] = [], templates: any[] = [];
const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]) => key === 'OR' ? (value as any[]).some(v => matches(row, v)) : row[key] === value);
const find = ({ where, orderBy }: any) => [...rows].sort((a, b) => orderBy?.revision ? b.revision - a.revision : 0).find(row => matches(row, where)) || null;
let tail = Promise.resolve();
const database: any = {
  uValueCalculation: {
    findUnique: async (args: any) => find(args), findFirst: async (args: any) => find(args),
    create: async ({ data }: any) => { const row = { ...structuredClone(data), id: `calc-${rows.length + 1}`, createdAt: new Date() }; rows.push(row); return row; },
    update: async ({ where, data }: any) => Object.assign(rows.find(row => matches(row, where)), data),
  },
  uValueReviewEvent: {
    findUnique: async ({ where }: any) => events.find(row => matches(row, where)) || null,
    create: async ({ data }: any) => { const event = { ...structuredClone(data), id: `event-${events.length + 1}`, createdAt: new Date() }; events.push(event); return event; },
  },
  uValueTemplate: {
    upsert: async ({ create }: any) => { const existing = templates.find(t => ['organisationId', 'sourceCalculationId', 'name'].every(k => t[k] === create[k])); if (existing) return existing; const t = { ...structuredClone(create), id: `template-${templates.length + 1}` }; templates.push(t); return t; },
    findFirst: async ({ where }: any) => templates.find(t => matches(t, where)) || null,
  },
  project: { findFirst: async ({ where }: any) => where.id === 'project' ? { id: 'project', name: 'House' } : null },
  $queryRaw: async () => [],
  // Model the database lock's serial execution; SQL lock identity is checked below.
  $transaction: (fn: any) => { const result = tail.then(() => fn(database)); tail = result.then(() => {}, () => {}); return result; },
};
const modules: Record<string, unknown> = { 'node:crypto': { createHash }, zod: { z }, '@/lib/db/prisma': { prisma: database }, '@/lib/utils/http': { HttpError, jsonResponse }, '@/lib/u-value/calculator': calculator };
const load = (path: string) => {
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date, console, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } }); return exports;
};
const saveService = load('src/server/services/u-value.service.ts');
const reviewService = load('src/server/services/u-value-review.service.ts');
const scope = { organisationId: 'org', organisationName: 'Practice', userId: 'user', userName: 'Architect', database };
let serial = 1;
const uuid = () => `00000000-0000-4000-8000-${String(serial++).padStart(12, '0')}`;
const inputs = { element: 'wall', correctionsAssessed: true, layers: [{ id: 'ins', kind: 'solid', name: 'Insulation', thicknessMm: 100, lambda: .04, source: 'Verified material design value' }] };
const save = (body: object = {}) => saveService.saveUValueCalculation({ ...scope, body: { requestId: uuid(), title: 'Wall W01', projectId: 'project', inputs, ...body } });
const checks = { geometry: true, designValues: true, corrections: true, scope: true };
const review = (row: any, action: string, body: object = {}, owner: object = {}) => reviewService.reviewUValueCalculation({ ...scope, ...owner, calculationId: row.id, body: { requestId: uuid(), action, inputHash: row.inputHash, statement: 'Checked against the current drawing and assessment.', ...(action === 'review' ? { checks } : {}), ...body } });
const root = await save();
assert.equal(root.status, 'DRAFT'); assert.equal(root.revision, 1);
await assert.rejects(review(root, 'issue'), /unavailable/);
await assert.rejects(review(root, 'review', { checks: undefined }), /four review checks/);
await assert.rejects(review(root, 'review', { inputHash: 'f'.repeat(64) }), /fingerprint/);
await assert.rejects(review(root, 'review', {}, { organisationId: 'other' }), /not found/);
const requestId = uuid();
const same = await Promise.all([review(root, 'review', { requestId }), review(root, 'review', { requestId })]);
assert.equal(same[0].id, same[1].id); assert.equal(events.length, 1);
await assert.rejects(review(root, 'review', { requestId, statement: 'Changed review statement.' }), /another review action/);
await review(root, 'issue'); assert.equal(root.status, 'ISSUED');
const snapshot = JSON.stringify(root.inputSnapshot);
const revisionId = uuid();
const revisions = await Promise.all([save({ basedOnId: root.id, requestId: revisionId }), save({ basedOnId: root.id, requestId: revisionId })]);
const revision = revisions[0]; assert.equal(revisions[1].id, revision.id); assert.equal(revision.revision, 2); assert.equal(revision.previousId, root.id); assert.equal(revision.seriesId, root.seriesId); assert.equal(revision.status, 'DRAFT');
assert.equal(JSON.stringify(root.inputSnapshot), snapshot); assert.equal(root.status, 'ISSUED');
await assert.rejects(save({ basedOnId: root.id }), /newer revision/);
await assert.rejects(save({ basedOnId: revision.id, projectId: null }), /same project/);
await assert.rejects(save({ basedOnId: 'foreign' }), /not found/);
await assert.rejects(review(root, 'review'), /newer revision/);
await review(root, 'withdraw', { statement: 'Superseded construction is no longer applicable.' }); assert.equal(root.status, 'WITHDRAWN');
await review(revision, 'review');
const race = await Promise.allSettled([save({ basedOnId: revision.id }), review(revision, 'issue')]);
assert.equal(race[0].status, 'fulfilled'); assert.equal(race[1].status, 'rejected');
const latest = latestCalculations([...rows, { id: 'legacy-a', seriesId: null, revision: 1 }, { id: 'legacy-b', seriesId: null, revision: 1 }]);
assert.equal(latest.length, 3, 'separate legacy reports never collapse into one null series');
const legacy = { ...root, id: 'old-report', seriesId: null, revision: 1, status: 'DRAFT', idempotencyKey: 'legacy' }; rows.push(legacy);
assert.equal((await save({ basedOnId: legacy.id })).revision, 2);
for (const event of events) { assert.equal(event.inputHash.length, 64); assert.equal(event.actorId, 'user'); assert.equal(event.actorName, 'Architect'); }
let organisationId = 'org', signedIn = true;
Object.assign(modules, {
  '@/lib/server/origin-guard': { assertAllowedOrigin }, '@/lib/server/rate-limit': { assertRateLimit: () => {}, rateLimitPolicies: { mutation: {} } }, '@/lib/utils/handlers': { withErrorHandling },
  '@/server/services/u-value-review.service': reviewService,
  '@/server/permissions/authz': { requireOrganisation: async () => { if (!signedIn) throw new HttpError(401, 'Sign in required.'); return { organisation: { id: organisationId }, user: { id: 'user', name: 'Architect' } }; } },
});
const endpoint = load('src/pages/api/u-value/[id]/review.ts').POST;
const context = (body: any, origin = 'https://portal.test', id = revision.id) => ({ params: { id }, request: new Request(`https://portal.test/api/u-value/${id}/review`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
const command = { requestId: uuid(), action: 'review', inputHash: revision.inputHash, statement: 'Checked all relevant inputs.', checks };
assert.equal((await endpoint(context(command, 'https://evil.test'))).status, 403);
signedIn = false; assert.equal((await endpoint(context(command))).status, 401); signedIn = true;
organisationId = 'other'; assert.equal((await endpoint(context(command))).status, 404); organisationId = 'org';
assert.equal((await endpoint(context({ ...command, actorName: 'Forged reviewer' }))).status, 400);
const templatePost = load('src/pages/api/u-value/templates/index.ts').POST;
const templateGet = load('src/pages/api/u-value/templates/[id].ts').GET;
let response = await templatePost(context({ calculationId: root.id, name: 'Typical wall' })); assert.equal(response.status, 201);
await templatePost(context({ calculationId: root.id, name: 'Typical wall' })); assert.equal(templates.length, 1, 'template retry is idempotent');
assert.equal(templates[0].inputSnapshot.correctionsAssessed, false); assert.equal(templates[0].inputSnapshot.target, null); assert.ok(!('projectId' in templates[0].inputSnapshot));
organisationId = 'other'; assert.equal((await templateGet({ params: { id: templates[0].id } })).status, 404); assert.equal((await templatePost(context({ calculationId: root.id, name: 'Foreign' }))).status, 404); organisationId = 'org';
for (const path of ['src/server/services/u-value.service.ts', 'src/server/services/u-value-review.service.ts']) assert.match(fs.readFileSync(path, 'utf8'), /pg_advisory_xact_lock\(hashtextextended/);
console.log('PASS revision chains, duplicate/concurrent requests, stale issue prevention, legacy series, review audit, withdrawal, project fencing, authenticated review/template APIs, CSRF and template reassessment.');
