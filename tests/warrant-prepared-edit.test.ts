import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { AutomationJobStatus, AutomationJobType } from '@prisma/client';
import { buildingWarrantCertifierDetailsSchema } from '../src/lib/validation/domain';
import { withErrorHandling, parseBody } from '../src/lib/utils/handlers';
import { HttpError, jsonResponse } from '../src/lib/utils/http';

const routeFile = 'src/pages/api/building-warrant/[id]/certifier-details.ts';
const compiled = ts.transpileModule(fs.readFileSync(routeFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const matches = (record: any, where: any): boolean => Object.entries(where).every(([key, value]: [string, any]) =>
  value instanceof Date ? record[key]?.getTime() === value.getTime()
    : value && typeof value === 'object' && 'in' in value ? value.in.includes(record[key]) : record[key] === value);

function harness(options: { race?: boolean; identity?: string; status?: AutomationJobStatus } = {}) {
  const state = { job: {
    id: 'job', organisationId: 'org', projectId: 'project', type: AutomationJobType.BUILDING_WARRANT,
    status: options.status ?? AutomationJobStatus.READY, updatedAt: new Date('2026-10-01'), snapshotHash: 'original',
    claimedAt: null, claimedDeviceId: null, claimedByUserId: null, claimedByAgentId: null, agentRunId: null, completedAt: null,
    createdBy: { id: 'user', name: 'Architect', email: 'test@example.test' }, dataSnapshot: {},
  } as Record<string, any>, canonical: [] as any[], writes: [] as any[], events: 0, persists: 0, builds: 0 };
  const db = {
    buildingWarrantApplication: { findFirst: async () => ({ id: 'warrant', projectId: 'project', preparationData: {} }) },
    automationJob: {
      findFirst: async ({ where }: any) => matches(state.job, where) ? structuredClone(state.job) : null,
      updateMany: async ({ where, data }: any) => {
        if (!matches(state.job, where)) return { count: 0 };
        state.writes.push({ where, data }); Object.assign(state.job, data); return { count: 1 };
      },
    },
    $transaction: async (fn: (tx: any) => unknown) => fn(db),
  };
  const modules: Record<string, unknown> = {
    '@prisma/client': { AutomationJobStatus, AutomationJobType }, '@/lib/db/prisma': { prisma: db },
    '@/lib/server/origin-guard': { assertAllowedOrigin: () => {} },
    '@/lib/server/rate-limit': { assertRateLimit: () => {}, rateLimitPolicies: { mutation: {} } },
    '@/lib/validation/automation-job': { automationJobSnapshotV2Schema: { safeParse: () => ({ success: false }) } },
    '@/lib/validation/domain': { buildingWarrantCertifierDetailsSchema },
    '@/lib/utils/handlers': { withErrorHandling, parseBody }, '@/lib/utils/http': { HttpError, jsonResponse },
    '@/server/permissions/authz': { requireOrganisation: async () => ({ organisation: { id: 'org', name: 'Practice' }, user: { id: 'user' } }) },
    '@/server/services/application-preparation.service': { persistApplicationPreparationDraft: async () => { state.persists++; } },
    '@/server/services/application-lifecycle.service': {
      updateBuildingWarrantWithLifecycle: async (input: unknown) => { state.canonical.push(input); },
      recordAutomationReadinessTransition: async () => { state.events++; return { id: 'event' }; },
      drainLifecycleEventsBestEffort: async () => {},
    },
    '@/server/services/certifier-presets.service': { findOrCreateCertifierProfile: async () => ({ id: 'certifier', displayName: 'Saved certifier' }) },
    '@/server/services/desktop-automation-status.service': { automationJobApplicationId: () => options.identity ?? 'warrant' },
    '@/server/services/automation-jobs.service': { buildAutomationJobSnapshot: async () => {
      state.builds++;
      if (options.race) Object.assign(state.job, { status: AutomationJobStatus.CLAIMED, claimedDeviceId: 'agent', updatedAt: new Date() });
      return { preflight: { status: 'READY' }, snapshotHash: 'corrected', dataSnapshot: { corrected: true }, documentSnapshot: {} };
    } },
  };
  const exports: any = {};
  vm.runInNewContext(compiled, { exports, Date, require: (name: string) => {
    assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name];
  } });
  const save = (jobId: string | undefined = 'job') => exports.POST({ params: { id: 'warrant' }, request: new Request('https://example.test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      jobId: jobId === 'none' ? undefined : jobId, description: 'Corrected extension', estimatedValue: 10000, currentUse: 'Dwelling', proposedUse: 'Dwelling',
      typeOfWorkKeys: ['domestic_alteration_extension'], registrationAPart1: 'SER1', registrationAPart2: '123', certifierName: 'Test certifier',
      registrationBPart1: 'SER1', registrationBPart2: '456', approvedBody: 'Test body',
    }),
  }) });
  return { state, save };
}

const prepared = harness();
assert.equal((await prepared.save()).status, 200, 'a prepared READY job remains editable');
assert.equal(prepared.state.canonical[0].data.description, 'Corrected extension');
assert.equal(prepared.state.job.snapshotHash, 'corrected', 'the handoff receives the corrected details');
assert.equal(prepared.state.events, 1); assert.equal(prepared.state.persists, 1);
assert.equal(prepared.state.writes[0].where.organisationId, 'org');

const race = harness({ race: true });
assert.equal((await race.save()).status, 409);
assert.equal(race.state.canonical.length, 1, 'canonical corrections are retained');
assert.equal(race.state.job.status, 'CLAIMED');
assert.equal(race.state.job.snapshotHash, 'original', 'saving cannot overwrite an Agent claim');
assert.equal(race.state.writes.length, 0); assert.equal(race.state.events, 0); assert.equal(race.state.persists, 0);

const foreign = harness({ identity: 'another-warrant' });
assert.equal((await foreign.save()).status, 404);
assert.equal(foreign.state.canonical.length, 0, 'a mismatched job never writes application details');
for (const status of [AutomationJobStatus.CLAIMED, AutomationJobStatus.IN_PROGRESS, AutomationJobStatus.COMPLETED]) {
  const unavailable = harness({ status });
  assert.equal((await unavailable.save()).status, 404);
  assert.equal(unavailable.state.writes.length, 0);
}
const completed = harness({ status: AutomationJobStatus.COMPLETED });
assert.equal((await completed.save('none')).status, 200, 'application details can be edited after completion without rewriting the historic run');
assert.equal(completed.state.canonical.length, 1); assert.equal(completed.state.builds, 0);
console.log('Prepared Building Warrant edit, identity and Agent-claim race tests passed.');
