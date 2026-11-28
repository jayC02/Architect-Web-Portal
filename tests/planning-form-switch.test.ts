// Changing a planning application between Householder and Planning Permission.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { choosePlanningFormInTransaction, resolvePlanningForm } from '../src/server/services/planning-form.service';

const extensionDrawing = { analysisResult: { classification: { extractedFacts: [
  { fieldKey: 'application.descriptionOfWork', value: 'Rear extension to existing house', evidence: 'Title block', certainty: 'high' },
] } } };

const fakeDatabase = (application: Record<string, unknown>) => {
  const row = { id: 'p1', projectId: 'proj', organisationId: 'org', status: 'DRAFTING', submissionDate: null, preparationData: {}, ...application };
  const updates: unknown[] = [];
  const db = {
    planningApplication: {
      findFirst: async ({ where }: any) => (where.id === row.id && where.organisationId === row.organisationId ? row : null),
      update: async ({ data }: any) => { updates.push(data); Object.assign(row, data); return row; },
      updateMany: async ({ data }: any) => { updates.push(data); Object.assign(row, data); return { count: 1 }; },
    },
    project: { findFirst: async () => ({ buildingUse: 'residential', typeOfWorkKeys: ['domestic_alteration_extension'], projectType: null }) },
    projectDocument: { findMany: async () => [extensionDrawing] },
    automationJob: { findMany: async () => [] },
  };
  return { row, updates, db: db as any };
};
const input = (form: 'HOUSEHOLDER' | 'PLANNING_PERMISSION', expectedJobId: string | null = null) => ({
  organisation: { id: 'org', name: 'Practice' }, actor: { id: 'u1', name: 'Alex', email: 'a@example.com' },
  planningApplicationId: 'p1', form, expectedJobId, requestId: '7b0f7a4e-6a0c-4b0a-9d55-3e6d2f2a9b11',
});

// The drawings pick the form, and say why.
const fresh = fakeDatabase({});
const resolved = await resolvePlanningForm(fresh.db, 'org', 'p1');
assert.equal(resolved.form, 'HOUSEHOLDER');
assert.equal(resolved.chosenBy, 'SUGGESTED');
assert.match(resolved.reason ?? '', /Rear extension to existing house/);
assert.equal(resolved.jobType, 'HOUSEHOLDER_PLANNING');

// Switching saves the architect's choice and what the drawings suggested.
const switched = await choosePlanningFormInTransaction(fresh.db, input('PLANNING_PERMISSION'));
assert.deepEqual(switched, { changed: true, jobId: null }, 'no run yet, so nothing to replace');
const saved = (fresh.row.preparationData as any).planningForm;
assert.equal(saved.form, 'PLANNING_PERMISSION');
assert.equal(saved.chosenBy, 'USER');
assert.equal(saved.suggestedForm, 'HOUSEHOLDER');
assert.equal((await resolvePlanningForm(fresh.db, 'org', 'p1')).jobType, 'PLANNING_APPLICATION');

// Choosing the form already in use changes nothing.
const same = fakeDatabase({});
assert.deepEqual(await choosePlanningFormInTransaction(same.db, input('HOUSEHOLDER')), { changed: false, jobId: null });
assert.equal(same.updates.length, 0);

// A submitted application keeps its form.
for (const progressed of [{ status: 'SUBMITTED' }, { submissionDate: new Date('2026-11-01') }]) {
  await assert.rejects(choosePlanningFormInTransaction(fakeDatabase(progressed).db, input('PLANNING_PERMISSION')), /submitted/);
}
// A stale page cannot switch over a newer run.
await assert.rejects(choosePlanningFormInTransaction(fakeDatabase({}).db, input('PLANNING_PERMISSION', 'job-old')), /newer run/);
// Another organisation cannot see it.
await assert.rejects(choosePlanningFormInTransaction(fakeDatabase({ organisationId: 'other' }).db, input('PLANNING_PERMISSION')), /not found/);

// The route is origin-checked, rate-limited and organisation-scoped.
const route = readFileSync('src/pages/api/planning/[id]/form.ts', 'utf8');
assert.match(route, /assertAllowedOrigin[\s\S]*assertRateLimit[\s\S]*requireOrganisation/);
assert.match(route, /\.strict\(\)/);
// Prepare for desktop, Reset and the details page follow the chosen form instead of assuming Householder.
assert.match(readFileSync('src/pages/api/automation-jobs/index.ts', 'utf8'), /resolvePlanningForm[\s\S]*const type = planningForm\?\.jobType \?\? body\.type/);
const reset = readFileSync('src/server/services/automation-job-reset.service.ts', 'utf8');
assert.match(reset, /readPlanningForm\(application\.preparationData\)/);
assert.doesNotMatch(reset, /type: input\.type,/, 'a reset run takes the resolved type');
assert.match(readFileSync('src/pages/planning/[id]/preparation.astro', 'utf8'), /resolvePlanningForm\(prisma, auth\.organisation\.id, application\.id\)/);

console.log('planning-form-switch: ok');
