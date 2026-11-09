import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
import * as enums from '@prisma/client';
import * as schemas from '../src/lib/validation/application-draft';
import * as draftScreener from '../src/lib/projects/draft-screener';
import { BUILDING_WARRANT_CONFIRMATION_DEFAULTS } from '../src/lib/validation/domain';
import { APPLICATION_UPLOAD_LIMITS } from '../src/lib/application-upload-limits';
import { normaliseDraftAddresses } from '../src/lib/addresses/draft-address';
import { normaliseUkAddress } from '../src/lib/addresses/uk-address';
import { resolveLocationPlans } from '../src/lib/location-plan';
import { HttpError } from '../src/lib/utils/http';
import { evaluateApplicationDraftReadiness } from '../src/server/services/application-draft.service';
import { evaluateClientApplicationDraftReadiness } from '../src/lib/application-draft-readiness';
import { saveDraftClientCorrections } from '../src/server/services/application-draft-client.service';
import { clientReviewFixture } from './fixtures/client-applicant-review';

const work = ['new_build', 'conversion_change_of_use', 'demolition'] as const;
const warrantReview = () => schemas.applicationDraftReviewSchema.parse({
  ...clientReviewFixture().review,
  selectedApplicationType: 'BUILDING_WARRANT',
  project: { ...clientReviewFixture().review!.project, buildingUse: 'commercial', typeOfWorkKey: 'new_build' },
  application: { ...clientReviewFixture().review!.application, typeOfWorkKeys: work, presetKey: 'new_build', currentUse: 'Offices', proposedUse: 'Offices', estimatedValue: 35000 },
  confirmations: { ...BUILDING_WARRANT_CONFIRMATION_DEFAULTS, disabledPersonsFacilitiesOnly: false, certifierOfDesignCertificateAvailable: false, certifierOfConstructionCertificateAvailable: false },
});

function harness(kind: 'save' | 'commit', existingProject?: Record<string, unknown>) {
  const review = warrantReview();
  if (existingProject) { review.projectMode = 'existing'; review.existingProjectId = 'project-existing'; }
  const state: any = { id: 'draft', organisationId: 'org', status: 'NEEDS_REVIEW', expiresAt: new Date('2099-01-01'),
    resultingProjectId: null, confirmedData: review, documents: [{ id: 'location-plan', uploadStatus: 'READY', documentType: 'LOCATION_PLAN',
      originalFilename: 'Location plan.pdf', fileName: 'Location plan.pdf', analysisStatus: 'SUCCESS', revision: null, drawingNumber: null, drawingTitle: null }] };
  const writes = { projects: [] as any[], warrants: [] as any[], projectReads: [] as any[] };
  const db: any = {
    applicationDraft: { findFirst: async () => structuredClone(state), updateMany: async ({ data }: any) => { Object.assign(state, data); return { count: 1 }; },
      update: async ({ data }: any) => { Object.assign(state, data); return state; } },
    applicationDraftDocument: { update: async () => ({}), updateMany: async () => ({ count: 1 }) },
    client: { create: async () => ({ id: 'client' }) }, site: { create: async () => ({ id: 'site' }) },
    project: { findFirst: async (input: unknown) => { writes.projectReads.push(input); return existingProject ?? null; },
      create: async ({ data }: any) => { writes.projects.push(data); return { ...data, id: 'project-created', createdAt: new Date() }; } },
    projectDocument: { create: async () => ({ id: 'permanent-document' }) },
    buildingWarrantApplication: { create: async ({ data }: any) => { writes.warrants.push(data); return { id: 'warrant' }; } },
    automationJob: { findFirst: async () => null, upsert: async () => ({ id: 'job' }) },
    $transaction: async (fn: (tx: any) => unknown) => fn(db),
  };
  const modules: Record<string, any> = {
    'node:crypto': { randomUUID }, '@prisma/client': enums, '@/lib/db/prisma': { prisma: db },
    '@/lib/projects/draft-screener': draftScreener,
    '@/lib/validation/application-draft': schemas, '@/lib/validation/domain': { BUILDING_WARRANT_CONFIRMATION_DEFAULTS },
    '@/lib/utils/http': { HttpError }, '@/lib/application-upload-limits': { APPLICATION_UPLOAD_LIMITS },
    '@/lib/addresses/draft-address': { normaliseDraftAddresses }, '@/lib/addresses/uk-address': { normaliseUkAddress }, '@/lib/location-plan': { resolveLocationPlans },
    '@/server/services/application-draft.service': { evaluateApplicationDraftReadiness, getApplicationDraftForOrganisation: async () => structuredClone(state) },
    '@/server/services/application-draft-client.service': { saveDraftClientCorrections },
    '@/server/services/automation-jobs.service': { buildAutomationJobSnapshot: async () => ({ preflight: { status: 'READY' }, sourceType: 'WARRANT_RECORD', title: 'Warrant', snapshotHash: 'current', sourceUpdatedAt: new Date(), dataSnapshot: {}, documentSnapshot: {} }) },
    '@/server/services/lifecycle-events.service': { emitProjectCreatedLifecycleEvent: async () => ({ id: 'created-event' }), emitDocumentReviewCompletedLifecycleEvent: async () => ({ id: 'review-event' }) },
    '@/server/services/application-lifecycle.service': { recordAutomationReadinessTransition: async () => null },
    '@/server/services/application-preparation.service': { persistApplicationPreparationDraft: async () => ({}) },
    '@/server/services/workflow-effects.service': { drainWorkflowEffectsBestEffort: async () => {} },
    '@/server/services/pdf-classification.service': { configuredDocumentAnalysisIdentity: () => ({ provider: 'test', model: 'test' }) },
  };
  const file = kind === 'commit' ? 'src/server/services/application-draft-commit.service.ts' : 'src/server/services/application-draft.service.ts';
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const api: any = {};
  vm.runInNewContext(code, { exports: api, Date, Buffer, console, require: (name: string) => {
    if (name in modules) return modules[name];
    assert.ok(name.startsWith('@/server/services/') || name === '@/lib/server/upload-storage' || name === '@/lib/validation/document-intelligence', name);
    return {};
  } });
  return { review, state, writes, run: () => kind === 'commit'
    ? api.commitApplicationDraft('draft', { id: 'org', name: 'Practice' }, { id: 'user', name: 'Architect', email: 'test@example.test' }, review)
    : api.saveApplicationDraftReview('draft', 'org', review) };
}

const created = harness('commit');
await created.run();
assert.equal(created.writes.projects.length, 1);
assert.equal(created.writes.projects[0].buildingUse, 'commercial');
assert.deepEqual(Array.from(created.writes.projects[0].typeOfWorkKeys), work);
assert.deepEqual(Array.from(created.writes.warrants[0].preparationData.typeOfWorkKeys), work);
for (const buildingUse of [null, undefined]) {
  const incomplete = harness('commit');
  incomplete.review.project.buildingUse = buildingUse;
  for (const evaluate of [evaluateApplicationDraftReadiness, evaluateClientApplicationDraftReadiness]) {
    assert.ok(evaluate(incomplete.review).some(issue => issue.key === 'project.buildingUse'));
  }
  await assert.rejects(incomplete.run(), /Review the remaining/);
  assert.equal(incomplete.writes.projects.length, 0);
}

const existing = { id: 'project-existing', name: 'Stored project', clientId: 'client-existing', siteId: 'site-existing',
  createdAt: new Date(), buildingUse: 'residential', typeOfWorkKeys: ['domestic_alteration_extension'], projectType: 'domestic_alteration_extension' };
for (const kind of ['save', 'commit'] as const) {
  const attached = harness(kind, existing);
  attached.review.project.buildingUse = 'commercial';
  await attached.run();
  assert.equal(attached.state.confirmedData.project.buildingUse, 'residential');
  assert.deepEqual(Array.from(attached.state.confirmedData.application.typeOfWorkKeys), ['domestic_alteration_extension']);
  assert.equal(attached.writes.projects.length, 0, 'existing screening is reused, never replaced by submitted draft fields');
  for (const call of attached.writes.projectReads) assert.deepEqual(JSON.parse(JSON.stringify(call.where)), { id: 'project-existing', organisationId: 'org' });
  if (kind === 'commit') assert.deepEqual(Array.from(attached.writes.warrants[0].preparationData.typeOfWorkKeys), ['domestic_alteration_extension']);
}
const unscreened = harness('commit', { ...existing, buildingUse: null });
await assert.rejects(unscreened.run(), /Review the remaining/);
assert.equal(unscreened.writes.warrants.length, 0);
const historicalRetry = harness('commit', { ...existing, buildingUse: null });
Object.assign(historicalRetry.state, { status: 'COMMITTED', resultingProjectId: 'project-existing', resultingAutomationJobId: 'historic-job' });
assert.equal((await historicalRetry.run()).created, false, 'screening changes do not break an idempotent completed-draft retry');
console.log('Draft project screening: production save/commit persist new screening, reuse authoritative existing screening and block missing use passed.');
