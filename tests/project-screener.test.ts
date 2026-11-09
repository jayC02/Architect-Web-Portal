import { persistProjectScreeningChange } from '../src/server/services/project-screener.service';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { projectCreateSchema, projectSchema } from '../src/lib/validation/domain';
import * as screener from '../src/lib/projects/screener';
import { parseBody, withErrorHandling } from '../src/lib/utils/handlers';
import { HttpError, jsonResponse } from '../src/lib/utils/http';

const work = ['new_build', 'conversion_change_of_use', 'demolition'];
assert.deepEqual(screener.projectScreenerUpdateSchema.parse({ buildingUse: 'commercial', typeOfWorkKeys: [...work, 'new_build'] }), {
  buildingUse: 'commercial', typeOfWorkKeys: work, projectType: 'new_build',
});
assert.deepEqual(screener.projectScreenerUpdateSchema.parse({ buildingUse: 'residential', typeOfWorkKeys: 'new_build' }).typeOfWorkKeys, ['new_build']);
for (const value of [{}, { buildingUse: 'industrial', typeOfWorkKeys: work }, { buildingUse: 'residential', typeOfWorkKeys: [] }, { buildingUse: 'residential', typeOfWorkKeys: ['invented'] }]) {
  assert.equal(screener.projectScreenerUpdateSchema.safeParse(value).success, false);
}
assert.deepEqual(screener.readProjectScreener({ projectType: 'New build' }), { buildingUse: null, typeOfWorkKeys: ['new_build'], complete: false });
assert.deepEqual(screener.readProjectScreener({ projectType: 'arbitrary old text' }), { buildingUse: null, typeOfWorkKeys: [], complete: false });
assert.equal(screener.readProjectScreener({ buildingUse: 'commercial', typeOfWorkKeys: work, projectType: 'domestic_alteration_extension' }).complete, true);
assert.deepEqual(screener.readProjectScreener({ buildingUse: 'residential', typeOfWorkKeys: ['invented'], projectType: 'New build' }).typeOfWorkKeys, [], 'invalid stored types require correction rather than silently using a different legacy type');

function routeHarness(file: string, exists = true) {
  const calls = { auth: 0, origin: 0, rate: 0, updates: [] as any[], creations: [] as any[], effects: 0, invalidations: [] as any[] };
  const screeningDatabase: any = {
    project: { updateMany: async (input: unknown) => { calls.updates.push(input); return { count: exists ? 1 : 0 }; } },
    automationJob: { updateMany: async (input: unknown) => { calls.invalidations.push(input); return { count: 1 }; } },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(screeningDatabase),
  };
  const modules: Record<string, unknown> = {
    '@/server/services/project-screener.service': { persistProjectScreeningChange },
    '@/lib/db/prisma': { prisma: screeningDatabase },
    '@/lib/projects/screener': screener,
    '@/lib/validation/domain': { projectCreateSchema, projectSchema },
    '@/lib/server/origin-guard': { assertAllowedOrigin: () => { calls.origin++; } },
    '@/lib/server/rate-limit': { assertRateLimit: () => { calls.rate++; }, rateLimitPolicies: { mutation: {} } },
    '@/lib/utils/handlers': { parseBody, withErrorHandling },
    '@/lib/utils/http': { HttpError, jsonResponse },
    '@/lib/utils/perf': { withPerf: (_name: string, fn: () => unknown) => fn() },
    '@/server/permissions/authz': { requireOrganisation: async () => { calls.auth++; return { organisation: { id: 'org-a' }, user: { id: 'user-a' } }; } },
    '@/server/services/project-data.service': { resolveProjectLinks: async () => ({ clientId: null, siteId: null, derivedSite: null }) },
    '@/server/services/project-creation.service': { createProjectWithLifecycle: async (input: unknown) => { calls.creations.push(input); return { project: { id: 'created-project' }, lifecycleEventId: 'created-event' }; } },
    '@/server/services/workflow-effects.service': { drainWorkflowEffectsBestEffort: async () => { calls.effects++; } },
  };
  const exports: any = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name]; }, console });
  const send = (method: string, body: unknown, id: string | undefined = 'project-a') => exports[method]({
    params: { id }, request: new Request('https://example.test/api/projects/project-a/screener', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { calls, send };
}

for (const buildingUse of ['residential', 'commercial']) {
  const fixture = routeHarness('src/pages/api/projects/[id]/screener.ts');
  assert.equal((await fixture.send('PATCH', { buildingUse, typeOfWorkKeys: work })).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls.updates[0])), {
    where: { id: 'project-a', organisationId: 'org-a' }, data: { buildingUse, typeOfWorkKeys: work, projectType: 'new_build' },
  }, 'screening updates the project record and preserves every selected type');
  assert.deepEqual([fixture.calls.auth, fixture.calls.origin, fixture.calls.rate], [1, 1, 1]);
  assert.equal(fixture.calls.invalidations[0].where.status, 'READY');
  assert.equal(fixture.calls.invalidations[0].where.executionAuthorisedAt, null);
  assert.equal(fixture.calls.invalidations[0].where.claimedByAgentId, null);
  assert.equal(fixture.calls.invalidations[0].data.status, 'STALE');
  assert.equal(fixture.calls.invalidations[0].where.projectId, 'project-a');
}
const missing = routeHarness('src/pages/api/projects/[id]/screener.ts', false);
assert.equal((await missing.send('PATCH', { buildingUse: 'residential', typeOfWorkKeys: work })).status, 404, 'foreign or missing projects cannot be changed');
for (const body of [{ buildingUse: 'commercial', typeOfWorkKeys: [] }, { buildingUse: '', typeOfWorkKeys: work }]) {
  const invalid = routeHarness('src/pages/api/projects/[id]/screener.ts');
  assert.equal((await invalid.send('PATCH', body)).status, 400);
  assert.equal(invalid.calls.updates.length, 0);
}
const creation = routeHarness('src/pages/api/projects/index.ts');
assert.equal((await creation.send('POST', { name: 'Screened project', buildingUse: 'commercial', typeOfWorkKeys: work })).status, 201);
assert.equal(creation.calls.creations[0].data.buildingUse, 'commercial');
assert.deepEqual(Array.from(creation.calls.creations[0].data.typeOfWorkKeys), work);
assert.equal(creation.calls.creations[0].data.projectType, 'new_build');
assert.equal(creation.calls.creations[0].data.organisationId, 'org-a');
assert.equal(creation.calls.effects, 1);
assert.equal((await creation.send('POST', { name: 'Unscreened project' })).status, 400, 'new projects require explicit screening');
const general = routeHarness('src/pages/api/projects/[id].ts');
assert.equal((await general.send('PATCH', { name: 'Updated project', buildingUse: 'commercial', typeOfWorkKeys: work, projectType: 'obsolete' })).status, 200);
assert.equal(general.calls.updates[0].data.projectType, 'new_build', 'general project updates cannot contradict a supplied multi-type screener');
assert.equal(general.calls.updates[0].data.buildingUse, 'commercial');
console.log('Project screening: required creation, scoped persistence, multi-type preservation, legacy reads and invalid input passed.');

const jobs = [
  { id: 'unstarted', status: 'READY' }, { id: 'authorised', status: 'READY', executionAuthorisedAt: new Date() },
  { id: 'claimed', status: 'CLAIMED', claimedByAgentId: 'agent' }, { id: 'running', status: 'IN_PROGRESS', agentRunId: 'run' },
  { id: 'finished', status: 'COMPLETED' }, { id: 'another-project', status: 'READY', projectId: 'other-project' },
  { id: 'another-organisation', status: 'READY', organisationId: 'other-org' },
].map(value => ({ organisationId: 'org-a', projectId: 'project-a', type: 'BUILDING_WARRANT', executionAuthorisedAt: null,
  claimedAt: null, claimedDeviceId: null, claimedByUserId: null, claimedByAgentId: null, agentRunId: null, ...value }));
const transactionDatabase: any = {
  project: { updateMany: async () => ({ count: 1 }) },
  automationJob: { updateMany: async ({ where, data }: any) => {
    const selected = jobs.filter(job => Object.entries(where).every(([key, value]) => (job as any)[key] === value));
    selected.forEach(job => Object.assign(job, data)); return { count: selected.length };
  } },
  $transaction: async (operation: (tx: unknown) => unknown) => operation(transactionDatabase),
};
await persistProjectScreeningChange(transactionDatabase, { organisationId: 'org-a', projectId: 'project-a', data: { buildingUse: 'commercial' } });
assert.equal(jobs.find(job => job.id === 'unstarted')?.status, 'STALE');
assert.equal(jobs.find(job => job.id === 'authorised')?.status, 'READY', 'approved snapshots retain their authorised input');
for (const [id, status] of [['claimed', 'CLAIMED'], ['running', 'IN_PROGRESS'], ['finished', 'COMPLETED'], ['another-project', 'READY'], ['another-organisation', 'READY']]) {
  assert.equal(jobs.find(job => job.id === id)?.status, status, `${id} remains unchanged`);
}
console.log('Project screening edits invalidate only unstarted scoped reviews and preserve approved/running/history snapshots.');
