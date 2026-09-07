import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { AutomationJobStatus, AutomationJobType } from '@prisma/client';
import { withErrorHandling, parseBody } from '../src/lib/utils/handlers';
import { HttpError, jsonResponse } from '../src/lib/utils/http';

// Execute the actual endpoint, replacing its boundaries before loading it.
// No Prisma connection, credentials, live database or portal is used.
const routeFile = 'src/pages/api/planning/[id]/complete-details.ts';
const compiled = ts.transpileModule(fs.readFileSync(routeFile, 'utf8'), {
  fileName: routeFile,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const initialJob = () => ({
  id: 'job_a', organisationId: 'org_a', projectId: 'project_a',
  type: AutomationJobType.HOUSEHOLDER_PLANNING,
  status: AutomationJobStatus.READY as AutomationJobStatus,
  sourceType: 'PROJECT', createdBy: { id: 'user_a', name: 'Architect', email: 'test@example.com' },
  createdAt: new Date('2026-09-01T10:00:00Z'),
  updatedAt: new Date('2026-09-01T10:01:00Z'),
  snapshotHash: 'original-hash', dataSnapshot: { original: true },
  documentSnapshot: { documents: ['original'] },
  claimedAt: null, claimedDeviceId: null, claimedByUserId: null,
  claimedByAgentId: null, agentRunId: null, completedAt: null,
});

const matches = (record: Record<string, any>, where: Record<string, any>): boolean =>
  Object.entries(where).every(([key, value]) => {
    if (value instanceof Date) return record[key]?.getTime() === value.getTime();
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(record[key]);
    return record[key] === value;
  });

function harness(options: {
  beforeSnapshot?: (state: any) => void | Promise<void>;
  preflight?: string;
} = {}) {
  const state = {
    job: initialJob() as Record<string, any>, canonicalSaves: 0, snapshotsBuilt: 0,
    writes: [] as any[], events: [] as any[], persists: 0, drains: 0, authorisations: 0,
  };
  const database = {
    planningApplication: { findFirst: async () => ({ id: 'planning_a', projectId: 'project_a', preparationData: {} }) },
    automationJob: {
      findFirst: async ({ where }: any) => matches(state.job, where) ? structuredClone(state.job) : null,
      updateMany: async ({ where, data }: any) => {
        state.writes.push(structuredClone({ where, data }));
        if (!matches(state.job, where)) return { count: 0 };
        Object.assign(state.job, structuredClone(data), { updatedAt: new Date(state.job.updatedAt.getTime() + 1) });
        return { count: 1 };
      },
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(database),
  };
  const modules: Record<string, unknown> = {
    '@prisma/client': { AutomationJobStatus, AutomationJobType },
    '@/lib/db/prisma': { prisma: database },
    '@/lib/server/origin-guard': { assertAllowedOrigin: () => undefined },
    '@/lib/server/rate-limit': { assertRateLimit: () => undefined, rateLimitPolicies: { mutation: {} } },
    '@/lib/validation/automation-job': { automationJobSnapshotV2Schema: { safeParse: () => ({ success: false }) } },
    '@/lib/validation/domain': { planningPreparationDetailsSchema: { parse: (body: unknown) => body } },
    '@/lib/utils/handlers': { withErrorHandling, parseBody },
    '@/lib/utils/http': { HttpError, jsonResponse },
    '@/server/permissions/authz': {
      requireOrganisation: async () => ({ organisation: { id: 'org_a', name: 'Practice' }, user: { id: 'user_a' } }),
    },
    '@/server/services/application-preparation.service': {
      persistApplicationPreparationDraft: async () => { state.persists++; },
    },
    '@/server/services/application-lifecycle.service': {
      updatePlanningApplicationWithLifecycle: async () => { state.canonicalSaves++; },
      recordAutomationReadinessTransition: async (_tx: unknown, input: unknown) => {
        state.events.push(input);
        return { id: 'readiness_event' };
      },
      drainLifecycleEventsBestEffort: async () => { state.drains++; },
    },
    '@/server/services/desktop-automation-status.service': { automationJobApplicationId: () => 'planning_a' },
    '@/server/services/automation-job-run.service': {
      authoriseAutomationJobRun: async () => { state.authorisations++; return { compatibleAgentOnline: false }; },
    },
    '@/server/services/automation-jobs.service': {
      buildAutomationJobSnapshot: async () => {
        const revision = ++state.snapshotsBuilt;
        await options.beforeSnapshot?.(state);
        return {
          preflight: { status: options.preflight ?? 'READY' }, snapshotHash: `fresh-${revision}`,
          sourceUpdatedAt: new Date('2026-09-02T10:00:00Z'),
          dataSnapshot: { fresh: revision }, documentSnapshot: { documents: ['fresh'] },
        };
      },
    },
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(compiled, {
    exports, Date,
    require: (name: string) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
      return modules[name];
    },
  }, { filename: routeFile });
  const save = (body = { jobId: 'job_a' } as Record<string, unknown>): Promise<Response> => exports.POST({
    params: { id: 'planning_a' },
    request: new Request('https://example.com/api/planning/planning_a/complete-details', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  });
  return { state, save };
}

const assertNoFollowOn = (state: ReturnType<typeof harness>['state']) => {
  assert.equal(state.events.length, 0, 'losing save must not emit readiness');
  assert.equal(state.persists, 0, 'losing save must not persist preparation');
  assert.equal(state.drains, 0, 'losing save must not drain readiness effects');
  assert.equal(state.authorisations, 0, 'losing save must not requeue execution');
};

for (const status of [AutomationJobStatus.CLAIMED, AutomationJobStatus.IN_PROGRESS, AutomationJobStatus.CANCELLED]) {
  let claimed: unknown;
  const { state, save } = harness({ beforeSnapshot: (current) => {
    Object.assign(current.job, {
      status, claimedAt: new Date(), claimedDeviceId: 'device_a', claimedByAgentId: 'agent_a',
      claimedByUserId: 'user_a', agentRunId: 'run_a', updatedAt: new Date(),
    });
    claimed = structuredClone(current.job);
  } });
  const response = await save();
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.details.applicationDetailsSaved, true);
  assert.equal(body.details.automationSnapshotUpdated, false);
  assert.equal(state.canonicalSaves, 1);
  assert.deepEqual(state.job, claimed, 'claimed/started snapshot, hash and ownership must remain untouched');
  assertNoFollowOn(state);
}

// Independently test every predicate, without relying on status changing too.
for (const [key, value] of Object.entries({
  status: AutomationJobStatus.NEEDS_INPUT, updatedAt: new Date('2026-09-03T10:00:00Z'),
  snapshotHash: 'competing-hash', claimedAt: new Date(), claimedDeviceId: 'device_a',
  claimedByUserId: 'user_a', claimedByAgentId: 'agent_a', agentRunId: 'run_a', completedAt: new Date(),
  organisationId: 'org_b', projectId: 'project_b', type: AutomationJobType.BUILDING_WARRANT,
})) {
  const { state, save } = harness({ beforeSnapshot: (current) => { current.job[key] = value; } });
  assert.equal((await save()).status, 409, `${key} must be checked at write time`);
  assert.equal(state.job.snapshotHash, key === 'snapshotHash' ? value : 'original-hash');
  assertNoFollowOn(state);
}

for (const status of [AutomationJobStatus.DRAFT, AutomationJobStatus.PREFLIGHT_REQUIRED,
  AutomationJobStatus.NEEDS_INPUT, AutomationJobStatus.STALE, AutomationJobStatus.READY]) {
  const { state, save } = harness();
  state.job.status = status;
  const response = await save();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).queued, true);
  assert.equal(state.job.snapshotHash, 'fresh-1');
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].previousStatus, status);
  assert.equal(state.authorisations, 1);
  assert.equal(state.persists, 1);
}

const incomplete = harness({ preflight: 'NEEDS_INPUT' });
assert.equal((await incomplete.save()).status, 200);
assert.equal(incomplete.state.job.status, AutomationJobStatus.NEEDS_INPUT);
assert.equal(incomplete.state.authorisations, 0);

let release!: () => void;
const barrier = new Promise<void>((resolve) => { release = resolve; });
let arrived = 0;
const concurrent = harness({ beforeSnapshot: async () => {
  if (++arrived === 2) release();
  await barrier;
} });
const responses = await Promise.all([concurrent.save(), concurrent.save()]);
assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
assert.equal(concurrent.state.events.length, 1);
assert.equal(concurrent.state.authorisations, 1);
assert.equal(concurrent.state.persists, 1);

const alreadyClaimed = harness();
alreadyClaimed.state.job.status = AutomationJobStatus.CLAIMED;
assert.equal((await alreadyClaimed.save()).status, 409);
assert.equal(alreadyClaimed.state.snapshotsBuilt, 0);
assertNoFollowOn(alreadyClaimed.state);

const detailsOnly = harness();
assert.equal((await detailsOnly.save({})).status, 200);
assert.equal(detailsOnly.state.canonicalSaves, 1);
assert.equal(detailsOnly.state.snapshotsBuilt, 0);
assertNoFollowOn(detailsOnly.state);

console.log('Planning preparation snapshot race tests passed (isolated endpoint, simulated atomic writes).');
