import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { planningApplicationFeeSchema } from '../src/lib/validation/domain';
import * as enums from '@prisma/client';
import { HttpError, jsonResponse } from '../src/lib/utils/http';
import { withErrorHandling } from '../src/lib/utils/handlers';
import { editablePreparationStatuses } from '../src/lib/automation/preparation-editability';
import { TYPE_OF_WORK_KEYS } from '../src/lib/projects/type-of-work';

const code = ts.transpileModule(fs.readFileSync('src/pages/api/automation-jobs/[id]/preparation.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
async function save(type: string, work: string[] = [], raced = false) {
  const writes: any = {};
  const job: any = { id: 'job', organisationId: 'org', projectId: 'project', status: 'READY', type, updatedAt: new Date(), snapshotHash: 'old', project: { client: { id: 'client' }, site: { id: 'site' } }, dataSnapshot: {} };
  const tx: any = {
    automationJob: { findFirst: async () => job, updateMany: async ({ where, data }: any) => {
      assert.equal(where.status, 'READY'); assert.equal(where.snapshotHash, 'old'); assert.equal(where.claimedDeviceId, null);
      if (raced) return { count: 0 }; writes.job = data; return { count: 1 };
    } },
    client: { update: async () => ({ id: 'client' }) }, site: { update: async () => ({ id: 'site' }) },
    project: { updateMany: async ({ data }: any) => { writes.project = data; } },
    organisationDefaults: { upsert: async () => {} },
    planningApplication: { findFirst: async () => ({ preparationData: {} }), updateMany: async ({ data }: any) => { writes.planning = data; } },
    buildingWarrantApplication: { findFirst: async () => ({ preparationData: {} }), updateMany: async ({ data }: any) => { writes.warrant = data; } },
    $transaction: async (fn: any) => fn(tx),
  };
  const modules: any = {
    '@prisma/client': enums, zod: { z }, '@/lib/db/prisma': { prisma: tx }, '@/lib/projects/type-of-work': { TYPE_OF_WORK_KEYS },
    '@/lib/server/origin-guard': { assertAllowedOrigin: () => {} }, '@/lib/server/rate-limit': { assertRateLimit: () => {}, rateLimitPolicies: { mutation: {} } },
    '@/lib/validation/automation-job': { automationJobSnapshotV2Schema: { safeParse: () => ({ success: true, data: { planning: { recordId: 'planning' }, buildingWarrant: { recordId: 'warrant' }, documents: [] } }) } },
    '@/lib/validation/domain': { planningApplicationFeeSchema, clientSchema: z.any(), siteSchema: z.any(), organisationDefaultsSchema: z.any() },
    '@/lib/utils/handlers': { withErrorHandling }, '@/lib/utils/http': { HttpError, jsonResponse },
    '@/server/permissions/authz': { requireOrganisation: async () => ({ organisation: { id: 'org', name: 'Practice' }, user: { id: 'user', name: 'Architect', email: 'test@example.test' } }) },
    '@/server/services/application-preparation.service': { persistApplicationPreparationDraft: async () => ({}) },
    '@/server/services/application-lifecycle.service': { recordAutomationReadinessTransition: async () => { writes.event = true; }, drainLifecycleEventsBestEffort: async () => {} },
    '@/server/services/automation-jobs.service': { buildAutomationJobSnapshot: async () => ({ preflight: { status: 'READY' }, dataSnapshot: {}, documentSnapshot: {} }) },
    '@/lib/automation/preparation-editability': { editablePreparationStatuses },
  };
  const exports: any = {};
  vm.runInNewContext(code, { exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; }, Date, console, Set });
  const form = new FormData();
  for (const [key, value] of Object.entries({ projectName: 'Extension', projectType: 'HOUSEHOLDER', siteAddressLine1: '1 Test Road', siteTownCity: 'Glasgow', sitePostcode: 'G41 5AA', clientName: 'Test Client', description: 'Rear extension', soleOwner: 'true', discussedWithPlanningAuthority: 'true' })) form.set(key, value);
  for (const value of work) form.append('typeOfWorkKeys', value);
  const response = await exports.PATCH({ params: { id: 'job' }, request: new Request('https://example.test', { method: 'PATCH', body: form }) });
  return { response, writes };
}
const planning = await save('HOUSEHOLDER_PLANNING');
assert.equal(planning.response.status, 200);
assert.equal(planning.writes.project.projectType, 'HOUSEHOLDER');
assert.equal(planning.writes.planning.preparationData.soleOwner, true);
assert.equal(planning.writes.planning.preparationData.discussedWithPlanningAuthority, true);
assert.equal(planning.writes.warrant, undefined);
assert.equal(planning.writes.planning.preparationData.typeOfWorkKeys, undefined);
for (const values of [[], ['invented']]) {
  const warrant = await save('BUILDING_WARRANT', values);
  assert.equal(warrant.response.status, 400);
  const error = await warrant.response.text();
  assert.match(error, /Type of Work/); assert.doesNotMatch(error, /Array must|typeOfWorkKeys/);
  assert.deepEqual(warrant.writes, {});
}
const warrant = await save('BUILDING_WARRANT', [TYPE_OF_WORK_KEYS[0]]);
assert.equal(warrant.response.status, 200);
assert.deepEqual(Array.from(warrant.writes.warrant.preparationData.typeOfWorkKeys), [TYPE_OF_WORK_KEYS[0]]);
const race = await save('HOUSEHOLDER_PLANNING', [], true);
assert.equal(race.response.status, 409); assert.equal(race.writes.job, undefined); assert.equal(race.writes.event, undefined);
for (const state of ['CLAIMED', 'IN_PROGRESS', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCELLED', 'NEEDS_REVIEW', 'AWAITING_PORTAL_REVIEW']) assert.equal(editablePreparationStatuses.has(state), false);
const page = fs.readFileSync('src/pages/automation-job/[id].astro', 'utf8');
assert.match(page, /!canEdit \? <section[\s\S]*: !snapshot \|\| !draft[\s\S]*<form/);
assert.match(page, /canEdit \? await buildApplicationPreparationDraft/);
console.log('Customer preparation save and read-only state tests passed.');
