import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { prisma } from '../src/lib/db/prisma';
import { fencedProcessingWrite } from '../src/server/services/document-processing.service';

assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get('schema'), 'workflow_overhaul_preview_20261009');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results: Record<string, unknown> = {};
const names = ['Location Plan.pdf', 'Proposed Plans.pdf', 'Supporting Statement.pdf'];
const bytes = (name: string, salt: string) => Buffer.from(`%PDF-1.4\n% Synthetic ${name} ${salt}\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF`);
const control = async (failures: Record<string, number>) => {
  assert.ok((await fetch('http://127.0.0.1:4331/__ai/control', { method: 'POST', body: JSON.stringify({ failures }) })).ok);
};
const calls = async () => (await (await fetch('http://127.0.0.1:4331/__ai')).json()).calls as Array<{ filename: string; prompt: string }>;
const register = async (base: string) => {
  const context = await browser.newContext({ baseURL: base, reducedMotion: 'reduce' });
  const email = `hobby-${randomUUID()}@example.test`;
  const response = await context.request.post('/api/auth/register', { headers: { Origin: base }, data: { name: 'Hobby workflow verification', email, password: 'SyntheticFixture123!', organisationName: `Hobby verification ${randomUUID()}` } });
  assert.equal(response.status(), 201, await response.text());
  const member = await prisma.organisationMember.findFirstOrThrow({ where: { user: { email } } });
  await prisma.organisationDefaults.upsert({ where: { organisationId: member.organisationId }, update: {}, create: { organisationId: member.organisationId, practiceName: 'Fixture Architects', agentFirstName: 'Jane', agentLastName: 'Architect', agentEmail: 'agent@example.test', agentPhone: '07483882299', agentBuildingNumber: '10', agentAddressLine1: 'Office Street', agentTownCity: 'Glasgow', agentPostcode: 'G1 1AA' } });
  return context;
};
const read = async (context: any, id: string) => (await (await context.request.get(`/api/application-drafts/${id}`)).json()).draft;
const analyse = async (context: any, id: string, data: Record<string, boolean> = {}) => {
  const response = await context.request.post(`/api/application-drafts/${id}/analyse`, { headers: { Origin: 'http://127.0.0.1:4330' }, data });
  assert.ok(response.ok(), await response.text());
  return response.json();
};
const projection = (draft: any) => ({
  client: [draft.review.client.title, draft.review.client.firstName, draft.review.client.lastName, draft.review.client.email, draft.review.client.phone],
  site: [draft.review.site.buildingNumber, draft.review.site.addressLine1, draft.review.site.townCity, draft.review.site.postcode, draft.review.site.localAuthority],
  agent: [draft.review.agent.practiceName, draft.review.agent.firstName, draft.review.agent.lastName, draft.review.agent.email],
  application: [draft.review.selectedApplicationType, draft.review.application.description],
  documents: draft.documents.map((document: any) => [document.originalFilename, document.analysisStatus, document.documentType, document.drawingNumber, document.revision]),
});
const verifyExtraction = (draft: any) => {
  assert.ok(draft.review);
  assert.equal(draft.documents.length, 3);
  assert.deepEqual(draft.documents.map((d: any) => d.analysisStatus), ['SUCCESS', 'SUCCESS', 'SUCCESS']);
  assert.equal(draft.review.client.firstName, 'Anna'); assert.equal(draft.review.client.lastName, 'Campbell');
  assert.equal(draft.review.site.buildingNumber, '147'); assert.equal(draft.review.site.addressLine1, 'High Street');
  assert.equal(draft.review.agent.practiceName, 'Fixture Architects');
  assert.equal(draft.review.application.description, 'Construction of a single-storey rear extension');
  assert.deepEqual(draft.documents.map((d: any) => d.documentType), ['LOCATION_PLAN', 'PROPOSED_DRAWING', 'SUPPORTING_DOCUMENT']);
  assert.equal(draft.prepared.site.buildingNumber.sources[0].filename, 'Location Plan.pdf');
  assert.equal(draft.prepared.client.firstName.sources[0].filename, 'Supporting Statement.pdf');
};
const happy = async (base: string, lostAnalysis = false) => {
  await control({});
  const start = (await calls()).length;
  const context = await register(base);
  const page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let transfers = 0, finalisations = 0, analysisRequests = 0;
  page.on('request', request => { if (request.url().startsWith('http://127.0.0.1:4331') && request.method() === 'PUT') transfers++; });
  if (base.endsWith('4330')) await page.route('**/documents/*/finalise', async route => {
    const response = await route.fetch();
    if (++finalisations === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Injected lost finalisation response"}' });
    else await route.fulfill({ response });
  });
  await page.route('**/analyse', async route => {
    analysisRequests++;
    if (lostAnalysis && analysisRequests === 1) { await route.fetch(); await route.fulfill({ status: 504, contentType: 'application/json', body: '{"error":"Injected lost analysis response"}' }); }
    else await route.continue();
  });
  await page.goto('/applications/new'); await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-file-input]')).toBeEnabled({ timeout: 30_000 });
  await page.locator('[data-file-input]').setInputFiles(names.map(name => ({ name, mimeType: 'application/pdf', buffer: bytes(name, randomUUID()) })));
  await page.locator('select[name=applicationType]').selectOption('HOUSEHOLDER_PLANNING');
  await page.locator('textarea[name=notes]').fill('Rear domestic extension; preserve this context.');
  await page.locator('[data-submit]').click();
  if (lostAnalysis) {
    await expect(page.locator('[data-upload-error]')).toContainText('without re-uploading', { timeout: 60_000 });
    assert.equal(transfers, 3);
    await page.locator('[data-submit]').click();
  }
  await page.waitForURL(/\/applications\/(?!new)[^/]+$/, { timeout: 90_000 });
  const id = page.url().split('/').at(-1)!;
  await expect.poll(async () => (await read(context, id)).status, { timeout: 60_000 }).toMatch(/NEEDS_REVIEW|READY_TO_CREATE/);
  const draft = await read(context, id); verifyExtraction(draft);
  assert.equal(transfers, 3, 'successful files transfer once despite lost responses');
  const aiCalls = (await calls()).slice(start);
  assert.equal(aiCalls.length, 3, 'successful documents are analysed once');
  assert.ok(aiCalls.every(call => call.prompt.includes('HOUSEHOLDER_PLANNING') && call.prompt.includes('preserve this context')));
  assert.deepEqual(errors, []);
  await fs.mkdir('output/workflow/hobby', { recursive: true });
  await page.screenshot({ path: `output/workflow/hobby/${base.endsWith('4332') ? 'main' : lostAnalysis ? 'recovered' : 'review'}.png`, fullPage: true });
  results[base.endsWith('4332') ? 'main' : lostAnalysis ? 'lostResponse' : 'inline'] = { id, transfers, finalisations, analysisRequests, extracted: projection(draft) };
  console.log(`${base} multiple PDF review passed (${analysisRequests} analysis requests, ${transfers} transfers).`);
  return { context, page, draft };
};
try {
  const baseline = await happy('http://127.0.0.1:4332');
  const current = await happy('http://127.0.0.1:4330');
  assert.deepEqual(projection(current.draft), projection(baseline.draft), 'main and fixed branch retain classification and extraction');
  const retry = await happy('http://127.0.0.1:4330', true);
  await retry.context.close(); await baseline.context.close();
  // Human confirmation changes only unresolved fields; extraction remains intact.
  const review = { ...current.draft.review, project: { ...current.draft.review.project, internalReference: 'HOBBY-VERIFIED' },
    site: { ...current.draft.review.site, authorityVerification: 'confirmed', planningAuthority: 'Glasgow City Council', buildingStandardsAuthority: 'Glasgow City Council' },
    confirmations: { ...current.draft.review.confirmations, discussedWithPlanningAuthority: false, treesOnOrAdjacentToSite: false, newOrAlteredVehicleAccess: false, soleOwner: true, agriculturalHolding: false, applicationFee: 100 },
    documents: current.draft.review.documents.map((d: any) => ({ ...d, documentStatus: 'APPROVED' })) };
  const saved = await current.context.request.patch(`/api/application-drafts/${current.draft.id}`, { headers: { Origin: 'http://127.0.0.1:4330' }, data: { review, revision: current.draft.reviewRevision } });
  assert.equal(saved.status(), 200, await saved.text()); assert.deepEqual((await saved.json()).issues, []);
  await current.page.reload();
  await current.page.getByRole('button', { name: 'Create Project', exact: true }).click();
  await current.page.waitForURL(/\/projects\/[^/?]+\?/, { timeout: 60_000 });
  results.created = (await read(current.context, current.draft.id)).result;
  console.log('Prepared review confirmation and project creation passed.');
  // Upload API creates fresh bytes for every case so cache cannot hide failure injection.
  const uploadDraft = async (salt: string) => {
    const response = await current.context.request.post('/api/application-drafts', { headers: { Origin: 'http://127.0.0.1:4330' }, data: { applicationType: 'HOUSEHOLDER_PLANNING', notes: 'Rear domestic extension' } });
    assert.equal(response.status(), 201, await response.text()); const id = (await response.json()).draft.id;
    for (const name of names) {
      const pdf = bytes(name, salt);
      const reserve = await current.context.request.post(`/api/application-drafts/${id}/documents/upload-intent`, { headers: { Origin: 'http://127.0.0.1:4330' }, data: { filename: name, mimeType: 'application/pdf', size: pdf.length, clientSha256: createHash('sha256').update(pdf).digest('hex'), clientUploadId: randomUUID() } });
      assert.equal(reserve.status(), 201, await reserve.text()); const intent = await reserve.json();
      assert.ok((await fetch(intent.upload.uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: pdf })).ok);
      const finalised = await current.context.request.post(`/api/application-drafts/${id}/documents/${intent.document.id}/finalise`, { headers: { Origin: 'http://127.0.0.1:4330' } });
      assert.equal(finalised.status(), 200, await finalised.text());
    }
    return id;
  };
  await control({ 'Supporting Statement.pdf': 1 });
  const transientId = await uploadDraft(randomUUID());
  await analyse(current.context, transientId);
  const paused = await analyse(current.context, transientId, { resume: true });
  assert.equal(paused.draft.status, 'ANALYSING'); assert.ok(paused.processing.continueAfterMs >= 10_000);
  const originalIds = paused.draft.documents.map((d: any) => d.id);
  const callsBeforeResume = (await calls()).length;
  await current.page.close();
  const reopen = await current.context.newPage(); await reopen.goto(`/applications/${transientId}`);
  await expect.poll(async () => (await read(current.context, transientId)).status, { timeout: 50_000 }).toMatch(/NEEDS_REVIEW|READY_TO_CREATE/);
  const resumed = await read(current.context, transientId); verifyExtraction(resumed);
  assert.deepEqual(resumed.documents.map((d: any) => d.id), originalIds);
  assert.deepEqual((await calls()).slice(callsBeforeResume).map(call => call.filename), ['Supporting Statement.pdf']);
  results.transient = { id: transientId, retryWaitMs: paused.processing.continueAfterMs, sameDocumentIds: true };
  console.log('Transient provider failure, closed page, automatic resume and retained evidence passed.');
  await reopen.close();
  await control({});
  const interruptedId = await uploadDraft(randomUUID()); await analyse(current.context, interruptedId);
  const waiting = await prisma.documentProcessingJob.findFirstOrThrow({ where: { draftId: interruptedId, kind: 'DOCUMENT', state: 'WAITING' } });
  const abandoned = await prisma.documentProcessingJob.update({ where: { id: waiting.id }, data: { state: 'RUNNING', leaseOwner: 'terminated-request-fixture', leaseGeneration: 3, attempts: 1, leaseExpiresAt: new Date(Date.now() + 30_000) } });
  const interrupted = await analyse(current.context, interruptedId, { resume: true });
  assert.ok(interrupted.processing.continueAfterMs > 20_000, 'a live lease cannot be stolen by a duplicate request');
  await prisma.documentProcessingJob.update({ where: { id: waiting.id }, data: { leaseExpiresAt: new Date(0) } });
  const recovered = await analyse(current.context, interruptedId, { resume: true }); verifyExtraction(recovered.draft);
  assert.equal(await fencedProcessingWrite(abandoned, async () => { throw new Error('stale owner must not write'); }), false);
  results.interrupted = { id: interruptedId, boundedLeaseRecovery: true, staleOwnerRejected: true };
  console.log('Terminated request lease recovery and stale-write fencing passed.');
  await control({ 'Supporting Statement.pdf': 99 });
  const exhaustedId = await uploadDraft(randomUUID()); await analyse(current.context, exhaustedId);
  for (let attempt = 0; attempt < 5; attempt++) {
    await prisma.documentProcessingJob.updateMany({ where: { draftId: exhaustedId, state: 'RETRYING' }, data: { nextAttemptAt: new Date(0) } });
    await analyse(current.context, exhaustedId, { resume: true });
  }
  const exhausted = await read(current.context, exhaustedId);
  assert.equal(exhausted.documents[2].analysisStatus, 'FAILED');
  const exhaustedIds = exhausted.documents.map((d: any) => d.id); const beforeRetry = (await calls()).length;
  await control({});
  const retried = await analyse(current.context, exhaustedId, { force: true }); verifyExtraction(retried.draft);
  assert.deepEqual(retried.draft.documents.map((d: any) => d.id), exhaustedIds);
  assert.deepEqual((await calls()).slice(beforeRetry).map(call => call.filename), ['Supporting Statement.pdf']);
  // Re-preparation retains an architect's saved review and manual classifications.
  const edited = { ...retried.draft.review, client: { ...retried.draft.review.client, firstName: 'Architect-confirmed' }, documents: retried.draft.review.documents.map((d: any, index: number) => index === 1 ? { ...d, documentType: 'ELEVATION' } : d) };
  const editResponse = await current.context.request.patch(`/api/application-drafts/${exhaustedId}`, { headers: { Origin: 'http://127.0.0.1:4330' }, data: { review: edited, revision: retried.draft.reviewRevision } });
  assert.equal(editResponse.status(), 200, await editResponse.text());
  const kept = await analyse(current.context, exhaustedId, { force: true });
  assert.equal(kept.draft.review.client.firstName, 'Architect-confirmed'); assert.equal(kept.draft.review.documents[1].documentType, 'ELEVATION');
  assert.equal((await calls()).length, beforeRetry + 1, 'repeat preparation does not re-analyse successful documents');
  results.exhaustedRetry = { id: exhaustedId, sameDocumentIds: true, successfulFilesNotRepeated: true, manualReviewPreserved: true };
  console.log('Exhausted failure retry without re-upload and manual review preservation passed.');
  const foreign = await register('http://127.0.0.1:4330');
  assert.equal((await foreign.request.post(`/api/application-drafts/${exhaustedId}/analyse`, { headers: { Origin: 'http://127.0.0.1:4330' }, data: { resume: true } })).status(), 404);
  await foreign.close(); await current.context.close();
  await fs.writeFile('output/workflow/hobby/results.json', JSON.stringify(results, null, 2));
} finally { await control({}); await browser.close(); await prisma.$disconnect(); }
