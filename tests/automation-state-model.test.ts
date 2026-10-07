import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as enums from '@prisma/client';
import { HttpError, jsonResponse } from '../src/lib/utils/http';
import { recordApplicationSnapshot, recordAutomationOwnership, readAutomationHistory, readExecutionSnapshot } from '../src/server/services/automation-state-model.service';
import { authoriseAutomationJobRun } from '../src/server/services/automation-job-run.service';
import { automationRunState, applicationReviewState, editableRevision, objectRecord } from '../src/lib/automation/state-model';
import { desktopJobStatusSchema } from '../src/lib/validation/desktop-handoff';

const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
  if (key === 'OR') return value.some((part: any) => matches(row, part));
  if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
  if (value && typeof value === 'object' && 'startsWith' in value) return row[key].startsWith(value.startsWith);
  return row[key] === value;
});
function fixture(type = 'HOUSEHOLDER_PLANNING') {
  const isWarrant = type === 'BUILDING_WARRANT';
  const application: any = { id: 'application-a', organisationId: 'org-a', projectId: 'project-a', updatedAt: new Date(), status: 'DRAFTING', submissionDate: null };
  const job: any = {
    id: 'job-legacy-a', organisationId: 'org-a', projectId: 'project-a', type, status: 'READY', payloadVersion: 2,
    sourceUpdatedAt: new Date('2026-09-01'), snapshotHash: 'old-hash', executionAuthorisedAt: null,
    claimedDeviceId: null, claimedByAgentId: null, claimedAt: null, agentRunId: null, updatedAt: new Date(),
    lastCheckpoint: null, resultData: null,
    dataSnapshot: { snapshotVersion: 2, metadata: { jobId: 'job-legacy-a', projectId: 'project-a', organisationId: 'org-a', applicationType: type },
      planning: isWarrant ? null : { recordId: application.id, description: 'Original work' },
      buildingWarrant: isWarrant ? { recordId: application.id, description: 'Original work' } : null },
    documentSnapshot: { documents: [{ id: 'document-a', revision: 'A' }] },
  };
  const events: any[] = [];
  const credentials: any[] = [{ id: 'credential-a', organisationId: 'org-a', automationJobId: job.id }, { id: 'credential-b', organisationId: 'org-a', automationJobId: job.id }];
  const agent: any = { id: 'agent-a', organisationId: 'org-a', capabilities: { workflows: [type], snapshotVersions: [2], callbackContractVersions: [1], progressContractVersions: [1] } };
  const database: any = {
    automationJob: { findFirst: async ({where}: any) => matches(job, where) ? structuredClone(job) : null,
      updateMany: async ({where, data}: any) => { if (!matches(job, where)) return {count: 0}; Object.assign(job, data); return {count: 1}; } },
    planningApplication: { findFirst: async ({where}: any) => matches(application, where) ? structuredClone(application) : null },
    buildingWarrantApplication: { findFirst: async ({where}: any) => matches(application, where) ? structuredClone(application) : null },
    desktopAccessToken: { findFirst: async ({where}: any) => credentials.find(c => matches(c, where)) ?? null },
    agentRegistration: { findFirst: async ({where}: any) => matches(agent, where) ? agent : null, findMany: async () => [agent] },
    automationJobEvent: {
      findFirst: async ({where}: any) => structuredClone(events.find(e => matches(e, where)) ?? null),
      upsert: async ({where, create, update}: any) => { assert.deepEqual(update, {}); let event = events.find(e => e.idempotencyKey === where.idempotencyKey); if (!event) { event = structuredClone({...create, createdAt: new Date()}); events.push(event); } return structuredClone(event); },
      findMany: async ({where}: any) => structuredClone(events.filter(e => matches(e, where))),
    },
    $transaction: async (fn: any) => { const before = structuredClone(job), priorEvents = structuredClone(events); try { return await fn(database); } catch(error) { Object.assign(job,before); events.splice(0,events.length,...priorEvents); throw error; } },
  };
  return { database, job, application, events, credentials, agent, scope: {organisationId: 'org-a', jobId: job.id} };
}
for (const type of ['HOUSEHOLDER_PLANNING', 'BUILDING_WARRANT']) {
  const f = fixture(type);
  assert.equal((await readAutomationHistory(f.database,f.scope)).length,0, 'legacy rows need no backfill');
  await authoriseAutomationJobRun({...f.scope, database:f.database});
  assert.ok(f.job.executionAuthorisedAt);
  const snapshot = await recordApplicationSnapshot(f.database,f.scope);
  assert.equal(objectRecord(snapshot.payload).applicationId,f.application.id);
  assert.equal(objectRecord(snapshot.payload).identityStatus,'VERIFIED');
  f.application.description = 'Later edit';
  f.job.dataSnapshot[type === 'BUILDING_WARRANT' ? 'buildingWarrant' : 'planning'].description = 'Explicit re-preparation';
  const next = await recordApplicationSnapshot(f.database,f.scope);
  assert.notEqual(next.id,snapshot.id);
  assert.equal(objectRecord(snapshot.payload).dataSnapshot[type === 'BUILDING_WARRANT' ? 'buildingWarrant' : 'planning'].description,'Original work');
  assert.equal((await recordApplicationSnapshot(f.database,f.scope)).id,next.id,'same content is idempotent');
  Object.assign(f.job,{status:'CLAIMED',claimedDeviceId:'credential-a',claimedByAgentId:'agent-a',agentRunId:'agent-run-a',claimedAt:new Date('2026-09-29')});
  const first = await recordAutomationOwnership(f.database,f.scope,{reason:'claimed'});
  assert.equal(first.snapshotId,snapshot.id, 'authorised input remains pinned despite later preparation changes');
  const execution = await readExecutionSnapshot(f.database, f.scope, f.job);
  assert.equal(execution?.id, snapshot.id);
  const count = f.events.length;
  assert.deepEqual(await recordAutomationOwnership(f.database,f.scope,{reason:'claimed'}),first);
  assert.equal(f.events.length,count);
  f.job.status='IN_PROGRESS';
  await recordAutomationOwnership(f.database,f.scope,{reason:'started',eventId:'start-a'});
  f.job.status='AWAITING_PORTAL_REVIEW';f.job.resultData={outcome:'awaiting_user_portal_review'};
  await recordAutomationOwnership(f.database,f.scope,{reason:'result',eventId:'result-a',browserSessionId:'selenium-a'});
  assert.equal(f.events.find(e => e.eventType==='state_model.browser').payload.runId,first.runId);
  assert.equal(f.application.status,'DRAFTING');assert.equal(f.application.submissionDate,null);
  Object.assign(f.job,{status:'CLAIMED',claimedDeviceId:'credential-b',agentRunId:'agent-run-b',claimedAt:new Date('2026-09-30')});
  const second=await recordAutomationOwnership(f.database,f.scope,{reason:'claimed'});
  assert.notEqual(second.runId,first.runId);
  assert.equal(f.events.filter(e=>e.eventType==='state_model.run').length,2);
  assert.equal(f.events.find(e=>e.eventType==='state_model.browser').payload.runId,first.runId,'new run cannot steal browser');
  await assert.rejects(readAutomationHistory(f.database,{...f.scope,organisationId:'org-b'}),/not found/);
  await assert.rejects(recordApplicationSnapshot(f.database,{...f.scope,organisationId:'org-b'}),/not found/);
  f.agent.organisationId='org-b';
  await assert.rejects(recordAutomationOwnership(f.database,f.scope,{reason:'claimed'}),/agent does not belong/);
}
const old=fixture();old.job.payloadVersion=1;old.job.dataSnapshot={project:{id:'project-a'},planningApplication:{id:'application-a'}};
assert.equal(objectRecord((await recordApplicationSnapshot(old.database,old.scope)).payload).identityStatus,'VERIFIED');
old.job.dataSnapshot={};assert.equal(objectRecord((await recordApplicationSnapshot(old.database,old.scope)).payload).applicationId,null);
const foreign=fixture();foreign.application.organisationId='org-b';
assert.equal(objectRecord((await recordApplicationSnapshot(foreign.database,foreign.scope)).payload).applicationId,null,'never link a foreign application');
const rollback=fixture();rollback.database.automationJobEvent.upsert=async()=>{throw new Error('journal unavailable');};
await assert.rejects(authoriseAutomationJobRun({...rollback.scope,database:rollback.database}),/journal unavailable/);
assert.equal(rollback.job.executionAuthorisedAt,null,'snapshot failure rolls back authorisation');
assert.equal(automationRunState('AWAITING_PORTAL_REVIEW',{outcome:'paused_for_manual_input'}),'NEEDS_ATTENTION');
assert.equal(automationRunState('AWAITING_PORTAL_REVIEW',null),'NEEDS_ATTENTION');
assert.equal(automationRunState('NEEDS_REVIEW',{},'connection_lost'),'INTERRUPTED');
assert.equal(automationRunState('COMPLETED',{}),'PREPARED');
assert.equal(applicationReviewState('PREPARED'),'PREPARED');
assert.equal(editableRevision(new Date('2026-09-01')), '2026-09-01T00:00:00.000Z');
const callback={version:1,jobId:'job-legacy-a',callbackId:'99253cce-1e73-44c9-a2bc-6589c90cc8b9',occurredAt:new Date().toISOString(),status:'COMPLETED',eventType:'result',result:{outcome:'completed_to_final_review'}};
assert.equal(desktopJobStatusSchema.safeParse(callback).success,true);
assert.equal(desktopJobStatusSchema.safeParse({...callback,result:{...callback.result,browserSessionId:'selenium-a'}}).success,true);
assert.equal(desktopJobStatusSchema.safeParse({...callback,result:{...callback.result,browserSessionId:'x'.repeat(201)}}).success,false);
console.log('Phase 0 state-model tests passed: legacy/current snapshots, ownership, history, browser binding, atomic authorization and submission separation.');

// Execute the actual desktop GET serializer against old and newly journalled rows.
const routeCode = ts.transpileModule(fs.readFileSync('src/pages/api/desktop/automation-jobs/[id]/index.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const apiFixture = fixture();
const modules: any = {
  'node:crypto': await import('node:crypto'), '@prisma/client': enums,
  '@/lib/db/prisma': { prisma: apiFixture.database },
  '@/lib/server/rate-limit': { assertRateLimit: () => {}, rateLimitPolicies: { desktop: {} } },
  '@/lib/validation/desktop-handoff': { desktopJobStatusSchema },
  '@/lib/utils/handlers': { withErrorHandling: (fn: any) => fn(), parseBody: () => {} },
  '@/lib/utils/http': { HttpError, jsonResponse },
  '@/server/auth/desktop-token': { requireDesktopAuth: (context: any) => context.access, assertDesktopJobAccess: (access: any, id: string) => { assert.equal(access.automationJobId, id); } },
  '@/server/services/desktop-execution.service': {},
  '@/server/services/automation-lifecycle.service': {},
  '@/server/services/prepared-application-review.service': {},
  '@/server/services/automation-state-model.service': { recordAutomationOwnership, readExecutionSnapshot, STATE_MODEL_VERSION: 1 },
};
const exported: any = {};
vm.runInNewContext(routeCode, { exports: exported, require: (key: string) => { assert.ok(key in modules, key); return modules[key]; } });
const context: any = { params: { id: apiFixture.job.id }, access: { id: 'credential-a', organisationId: 'org-a', automationJobId: apiFixture.job.id } };
const legacyResponse = await (await exported.GET(context)).json();
assert.equal(legacyResponse.job.dataSnapshot.planning.description, 'Original work');
assert.equal(legacyResponse.job.documents[0].id, 'document-a');
assert.equal(legacyResponse.job.stateModel.retainedBrowserMetadata, true);
await authoriseAutomationJobRun({ ...apiFixture.scope, database: apiFixture.database });
apiFixture.job.dataSnapshot.planning.description = 'Later mutable edit';
apiFixture.job.documentSnapshot.documents = [];
const pinnedResponse = await (await exported.GET(context)).json();
assert.equal(pinnedResponse.job.dataSnapshot.planning.description, 'Original work');
assert.equal(pinnedResponse.job.documents[0].id, 'document-a');
await assert.rejects(exported.GET({ ...context, access: { ...context.access, organisationId: 'org-b' } }), /not found/);
console.log('Desktop GET compatibility passed: unchanged legacy payload and pinned authorised input after edits.');
// Execute started/result/duplicate callbacks through the actual PATCH endpoint.
Object.assign(apiFixture.job, { status: 'CLAIMED', claimedDeviceId: 'credential-a', claimedByAgentId: 'agent-a', agentRunId: 'callback-run', claimedAt: new Date(), leaseExpiresAt: new Date(Date.now()+60000) });
modules['@/server/auth/desktop-token'].assertDesktopTokenActive = async () => {};
modules['@/server/services/desktop-execution.service'].lockOrganisationExecution = async () => {};
modules['@/server/services/automation-lifecycle.service'].assertAutomationJobTransition = (await import('../src/server/services/automation-lifecycle.service')).assertAutomationJobTransition;
modules['@/server/services/prepared-application-review.service'].reconcilePreparedApplicationReview = async () => ({outcome:'opened'});
modules['@/lib/utils/handlers'].parseBody = async (body: unknown, schema: any) => schema.parse(body);
apiFixture.database.$queryRaw = async () => [];
apiFixture.database.$executeRaw = async () => 1;
apiFixture.database.deadline = { updateMany: async () => ({count:0}) };
const started = { ...callback, status: 'IN_PROGRESS', eventType: 'started', result: undefined };
assert.equal((await (await exported.PATCH({...context,request:started})).json()).status, 'IN_PROGRESS');
const finished = { ...callback, callbackId:'7741e2e8-2ebd-4e43-9f39-f8d0fdff9ba3', result:{...callback.result,browserSessionId:'callback-browser'} };
assert.equal((await (await exported.PATCH({...context,request:finished})).json()).status, 'COMPLETED');
assert.equal(apiFixture.application.submissionDate,null);
assert.equal(apiFixture.events.filter(e=>e.eventType==='state_model.browser').length,1);
const afterCallback = apiFixture.events.length;
apiFixture.database.$queryRaw = async () => [{id:'callback-existing'}];
assert.equal((await (await exported.PATCH({...context,request:finished})).json()).duplicate,true);
assert.equal(apiFixture.events.length,afterCallback);
await assert.rejects(exported.PATCH({...context,access:{...context.access,id:'credential-b'},request:finished}), /not claimed/);
console.log('Desktop PATCH compatibility passed: start/result, browser binding, duplicate delivery and stale-owner rejection.');
