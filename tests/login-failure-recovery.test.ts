import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as prismaTypes from '@prisma/client';
import { readAutomationFailureMetadata } from '../src/lib/automation/failure-recovery';
import { HttpError } from '../src/lib/utils/http';
import { agentPhoneError } from '../src/lib/validation/client-contact';

const result = { outcome: 'failed_final', failureCategory: 'AUTOMATION_FAILED', errorCode: 'AUTOMATION_FAILED', currentSection: 'login', retrySafe: false, safeRetryPoint: null, recoveryAction: 'close', lastCompletedStep: null };
const recovery = (data: object = result, status = 'FAILED_FINAL', stage = 'login', checkpoint = 'login') => readAutomationFailureMetadata(data, status, stage, { lastCheckpoint: checkpoint });
const login = recovery();
assert.equal(login.retrySafe, true); assert.equal(login.recoveryAction, 'update_login'); assert.equal(login.headline, 'Sign-in did not complete');
assert.equal(readAutomationFailureMetadata(result, 'FAILED_FINAL', 'login').retrySafe, false, 'no historical checkpoint evidence means no final-failure override');
for (const status of ['READY', 'IN_PROGRESS', 'NEEDS_REVIEW', 'AWAITING_PORTAL_REVIEW', 'COMPLETED', 'CANCELLED']) assert.equal(recovery(result, status).retrySafe, false);
for (const stage of ['proposal', 'documents', 'fee', 'unknown']) assert.equal(recovery(result, 'FAILED_FINAL', stage).retrySafe, false);
for (const checkpoint of ['proposal', 'documents', 'fee', '']) assert.equal(recovery(result, 'FAILED_FINAL', 'login', checkpoint).retrySafe, false);
for (const changed of [
  { currentSection: 'documents' }, { lastCompletedStep: 'proposal' }, { safeRetryPoint: 'documents' }, { documentsUploaded: 1 }, { browserSessionId: 'retained-browser' },
  { errorCode: 'PROPOSAL_CREATION_UNCERTAIN' }, { failureCategory: 'AUTHENTICATION_FAILED' }, { recoveryAction: 'review_portal' }, { outcome: 'awaiting_user_portal_review' },
]) assert.equal(recovery({ ...result, ...changed }).retrySafe, false, JSON.stringify(changed));
assert.equal(recovery({ retrySafe: true, recoveryAction: 'update_login' }, 'FAILED_RETRYABLE').retrySafe, true, 'current Agent contract still works');

let old: any = { id: 'old', organisationId: 'practice', projectId: 'project', type: 'BUILDING_WARRANT', status: 'FAILED_FINAL', progressStage: 'login', lastCheckpoint: 'login', resultData: structuredClone(result), dataSnapshot: { untouched: true } };
let jobs: any[] = [], event: any = null, snapshots = 0, builds = 0;
let preflight: any = { status: 'READY' };
const tx: any = {
  $executeRaw: async () => {},
  automationJob: { findFirst: async ({ where }: any) => where.organisationId !== 'practice' ? null : where.id === 'old' ? old : typeof where.id === 'string' ? jobs.find(j => j.id === where.id) ?? null : jobs.find(j => where.status.in.includes(j.status)) ?? null,
    create: async ({ data }: any) => { jobs.push(data); return data; } },
  automationJobEvent: { findUnique: async () => event, create: async ({ data }: any) => { event = data; } },
  deadline: { updateMany: async () => ({ count: 0 }) },
};
const exports: any = {};
const modules: Record<string, unknown> = {
  '@/lib/validation/client-contact': { agentPhoneError },
  '@prisma/client': prismaTypes, '@/lib/db/prisma': { prisma: {} }, '@/lib/utils/http': { HttpError }, '@/lib/automation/failure-recovery': { readAutomationFailureMetadata },
  '@/server/services/automation-state-model.service': { recordAuthorisedSnapshot: async () => { snapshots++; } },
  '@/lib/validation/automation-job': {}, '@/server/auth/desktop-token': {},
  '@/server/services/desktop-execution.service': { lockOrganisationExecution: async () => {} },
  '@/server/services/desktop-automation-status.service': { resolveAutomationJobIdentity: () => ({ applicationId: 'warrant' }) },
  '@/server/services/desktop-agent.service': {},
  '@/server/services/automation-jobs.service': { buildFreshAutomationJob: async (input: any, database: any) => {
    assert.equal(database, tx); assert.equal(input.buildingWarrantApplicationId, 'warrant'); builds++;
    return { jobId: `new-${builds}`, createdAt: new Date(), snapshot: { preflight, dataSnapshot: { currentCanonicalData: true, organisation: { agent: { phone: '01410000000' } } }, documentSnapshot: { currentReviewedDocuments: true }, sourceType: 'PROJECT' } };
  } },
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/server/services/automation-job-restart.service.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, Date, console, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } });
const input = { organisation: { id: 'practice', name: 'Practice' }, actor: { id: 'user', name: 'Architect', email: 'test@example.test' }, oldJobId: 'old' };
const before = structuredClone(old);
const fresh = await exports.restartFailedAutomationJobInTransaction(tx, input);
assert.equal(fresh.status, 'READY'); assert.ok(fresh.executionAuthorisedAt instanceof Date, 'an explicit restart request authorises the fresh attempt');
assert.deepEqual(fresh.dataSnapshot, { currentCanonicalData: true, organisation: { agent: { phone: '01410000000' } } }); assert.equal(snapshots, 1); assert.deepEqual(old, before);
assert.equal((await exports.restartFailedAutomationJobInTransaction(tx, input)).id, fresh.id); assert.equal(jobs.length, 1, 'one successor even if recovery response is lost');
jobs[0].dataSnapshot.organisation.agent.phone = null;
await assert.rejects(exports.restartFailedAutomationJobInTransaction(tx, input), /agent telephone.*web portal before resuming/);
assert.equal(jobs.length, 1, 'an invalid old READY successor cannot create another run');
event = null; jobs = []; old = { ...before, progressStage: 'documents' };
await assert.rejects(exports.restartFailedAutomationJobInTransaction(tx, input), /not confirmed safe/); assert.equal(jobs.length, 0);
old = before; await assert.rejects(exports.restartFailedAutomationJobInTransaction(tx, { ...input, organisation: { id: 'other', name: 'Other' } }), /not found/);
const priorSnapshots = snapshots;
preflight = { status: 'NEEDS_INPUT', missing: [{ field: 'organisation.agent.phone', message: 'Enter the agent telephone number required by eDevelopment.' }] };
await assert.rejects(exports.restartFailedAutomationJobInTransaction(tx, input), /agent telephone.*web portal before resuming/);
assert.equal(jobs.length, 0, 'a resume with no phone must not queue a successor');
assert.equal(event, null);
assert.equal(snapshots, priorSnapshots, 'no execution snapshot is authorised');
console.log('PASS exact legacy login recovery, contradictory/late-state rejection, fresh canonical snapshots, history preservation, organisation isolation, idempotency and explicit run authorisation.');
