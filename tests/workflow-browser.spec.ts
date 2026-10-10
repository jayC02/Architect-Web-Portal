import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

const base = 'http://127.0.0.1:4330';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF');
test('isolated PDF journey, closed-page analysis, recovery, confirmation, fees and active Agent queue', async ({ page, context, browser }) => {
  const stamp = Date.now();
  const registration = await context.request.post(`${base}/api/auth/register`, { headers: { Origin: base }, data: { name: 'Workflow browser tester', email: `workflow-browser-${stamp}@example.test`, password: 'SyntheticFixture123!', organisationName: `Workflow isolated ${stamp}` } });
  expect(registration.status()).toBe(201);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let transfers = 0, verifications = 0;
  page.on('request', request => { if (request.url().startsWith('http://127.0.0.1:4331') && request.method() === 'PUT') transfers++; });
  await page.route('**/documents/*/finalise', async route => {
    verifications++;
    const response = await route.fetch();
    if (verifications === 1 && response.ok()) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Injected lost verification response' }) });
    else await route.fulfill({ response });
  });
  await page.goto('/applications/new');
  // Let the cold local Vite dependency optimiser finish before selecting a
  // memory-only file; its development reload is unrelated to upload recovery.
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-file-input]')).toBeEnabled({ timeout: 30_000 });
  await page.locator('[data-file-input]').setInputFiles({ name: 'Location Plan.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.locator('[data-file-panel]')).toBeVisible();
  await page.locator('select[name=applicationType]').selectOption('HOUSEHOLDER_PLANNING');
  await page.locator('[data-submit]').click();
  await page.waitForURL(/\/applications\/(?!new)[^/]+$/, { timeout: 90_000 });
  const draftId = page.url().split('/').at(-1)!;
  expect(transfers).toBe(1); expect(verifications).toBeGreaterThanOrEqual(2);
  await page.close();
  // With no page open, only the persisted queue and server worker can finish.
  let draft: any;
  await expect.poll(async () => {
    const response = await context.request.get(`${base}/api/application-drafts/${draftId}`); draft = (await response.json()).draft;
    return draft?.review ? draft.status : 'waiting';
  }, { timeout: 90_000, intervals: [500,1000,2000] }).toMatch(/NEEDS_REVIEW|READY_TO_CREATE/);
  const person = { ...draft.review.client, clientType: 'INDIVIDUAL', displayName: 'Anna Campbell', title: 'Ms', firstName: 'Anna', lastName: 'Campbell', email: 'anna@example.test', phone: '07483882299', buildingNumber: '147', addressLine1: 'High Street', addressLine2: null, townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom' };
  const review = { ...draft.review, selectedApplicationType: 'HOUSEHOLDER_PLANNING', projectMode: 'create', existingProjectId: null,
    project: { name: '147 High Street extension', internalReference: `AP-${stamp}`, typeOfWorkKey: 'domestic_alteration_extension', summary: 'Rear domestic extension' },
    siteMode: 'create', existingSiteId: null, site: { ...draft.review.site, buildingNumber: '147', addressLine1: 'High Street', townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom', localAuthority: 'Glasgow City Council', authorityVerification: 'confirmed', planningAuthority: 'Glasgow City Council', buildingStandardsAuthority: 'Glasgow City Council' },
    clientMode: 'create', existingClientId: null, client: person, clientAddressSameAsSite: false, applicantDifferentFromClient: true,
    applicant: { ...person, displayName: 'Alex Campbell', firstName: 'Alex', email: 'alex@example.test' },
    agent: { ...draft.review.agent, practiceName: 'Fixture Architects', firstName: 'Jane', lastName: 'Architect', email: 'agent@example.test', phone: '07483882299', buildingNumber: '10', addressLine1: 'Office Street', townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom' },
    application: { ...draft.review.application, description: 'Construction of a single-storey rear extension', presetKey: 'domestic_alteration_extension', typeOfWorkKeys: ['domestic_alteration_extension'] },
    confirmations: { ...draft.review.confirmations, discussedWithPlanningAuthority: false, treesOnOrAdjacentToSite: false, newOrAlteredVehicleAccess: false, soleOwner: true, agriculturalHolding: false, applicationFee: 100 },
    documents: draft.review.documents.map((document: any) => ({ ...document, documentType: 'LOCATION_PLAN', documentStatus: 'APPROVED' })) };
  const saved = await context.request.patch(`${base}/api/application-drafts/${draftId}`, { headers: { Origin: base }, data: { review, revision: draft.reviewRevision } });
  expect(saved.status(), await saved.text()).toBe(200); const savedData = await saved.json(); expect(savedData.issues).toEqual([]);
  const stale = await context.request.patch(`${base}/api/application-drafts/${draftId}`, { headers: { Origin: base }, data: { review: { ...review, project: { ...review.project, name: 'Stale edit' } }, revision: draft.reviewRevision } }); expect(stale.status()).toBe(409);
  const current = await context.newPage(); current.on('pageerror', error => errors.push(error.message));
  await current.route('**/address-lookup', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Mock provider outage; manual address retained"}' }));
  await current.goto(`/applications/${draftId}`);
  await expect(current.getByRole('button', { name: 'Create Project', exact: true })).toBeVisible();
  // Toggle twice and confirm that the separately entered applicant survives.
  await current.locator('summary').filter({ hasText: 'Client and applicant' }).click();
  const relationship = current.getByLabel('Use client as applicant'); await relationship.check();
  await current.getByLabel('Use a different applicant').uncheck();
  await expect(current.locator('#separate-applicant-heading').locator('..').getByLabel('First name')).toHaveValue('Alex');
  await fs.mkdir('output/playwright/workflow/screenshots', { recursive: true });
  await current.screenshot({ path: 'output/playwright/workflow/screenshots/prepared-review.png', fullPage: true });
  await current.getByRole('button', { name: 'Create Project', exact: true }).click();
  await current.waitForURL(/\/projects\/[^/?]+\?/, { timeout: 60_000 });
  const projectId = new URL(current.url()).pathname.split('/').at(-1)!;
  await current.getByRole('button', { name: 'Add project fee', exact: true }).click();
  const feeDialog = current.getByRole('dialog'); await expect(feeDialog).toBeVisible();
  await feeDialog.getByLabel('Agreed fee, excluding VAT').fill('100.01'); await feeDialog.getByLabel('VAT treatment').selectOption('ZERO');
  await feeDialog.getByText('Optional billing schedule and notes', { exact: true }).click();
  await feeDialog.getByRole('combobox', { name: /billing schedule/i }).selectOption('percent');
  let feeCalls = 0;
  await current.route('**/fee-plan', async route => { if (route.request().method() !== 'PUT') return route.continue(); if (++feeCalls === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Injected temporary save failure"}' }); return route.continue(); });
  await feeDialog.getByRole('button', { name: 'Save project fee' }).click(); await expect(feeDialog.getByRole('alert')).toContainText('Injected');
  await expect(feeDialog.getByLabel('Agreed fee, excluding VAT')).toHaveValue('100.01');
  await feeDialog.getByRole('button', { name: 'Save project fee' }).click(); await expect(feeDialog).not.toBeVisible({ timeout: 30_000 });
  await expect(current.locator('#fees')).toContainText('£100.01'); await expect(current.locator('#fees')).toContainText('£50.01');
  await current.getByRole('button', { name: 'Edit project details' }).click();
  await expect(current.getByRole('dialog', { name: 'Edit project details' })).toBeVisible();
  await current.keyboard.press('Escape');
  await expect(current.getByRole('button', { name: 'Edit project details' })).toBeFocused();
  const clientButton = current.getByRole('button', { name: 'Edit client Anna Campbell' }); await clientButton.click();
  await expect(current.getByRole('dialog')).toBeVisible(); await current.keyboard.press('Escape'); await expect(current.getByRole('dialog')).not.toBeVisible(); await expect(clientButton).toBeFocused();
  await clientButton.click(); await current.getByRole('dialog').getByLabel('First name', { exact: true }).fill('Unsaved');
  current.once('dialog', dialog => dialog.dismiss()); await current.keyboard.press('Escape'); await expect(current.getByRole('dialog')).toBeVisible();
  current.once('dialog', dialog => dialog.accept()); await current.keyboard.press('Escape'); await expect(current.getByRole('dialog')).not.toBeVisible();
  // Queue authorisation retains an immutable snapshot and never submits.
  const finalDraft = (await (await context.request.get(`${base}/api/application-drafts/${draftId}`)).json()).draft;
  const jobId = finalDraft.result.automationJobId;
  const queued = await context.request.post(`${base}/api/automation-jobs/${jobId}/run`, { headers: { Origin: base } }); expect(queued.status(), await queued.text()).toBe(200);
  await current.reload();
  // Project photos retain their supported type, while a larger PDF uses real
  // tus-js-client chunks and resumes after an injected expired storage token.
  await current.goto(`/documents/upload?projectId=${projectId}`);
  let tusCreates = 0, tusHeads = 0, tusPatches = 0;
  await current.route('http://127.0.0.1:4331/storage/v1/upload/resumable**', async route => {
    const method = route.request().method();
    if (method === 'POST') tusCreates++;
    if (method === 'HEAD') tusHeads++;
    if (method === 'PATCH' && ++tusPatches === 1) return route.fulfill({ status: 403, body: 'Storage token expired' });
    return route.continue();
  });
  const largePdf = Buffer.concat([pdf, Buffer.alloc(7 * 1024 * 1024, 32)]);
  await current.locator('input[type=file]').setInputFiles([
    { name: 'Survey.pdf', mimeType: 'application/pdf', buffer: largePdf },
    { name: 'Site photograph.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64') },
  ]);
  await current.getByRole('button', { name: 'Upload documents', exact: true }).click();
  await expect(current.getByRole('listitem').filter({ hasText: 'Survey.pdf' })).toContainText('Ready', { timeout: 60_000 });
  await expect(current.getByRole('listitem').filter({ hasText: 'Site photograph.png' })).toContainText('Ready');
  expect(tusCreates).toBe(1); expect(tusHeads).toBeGreaterThanOrEqual(1); expect(tusPatches).toBe(2);
  // Cancelling fences the old identity, while explicit file reselection remains
  // possible. Even a late storage transfer cannot finalise the cancelled id.
  const uploadBase = `${base}/api/projects/${projectId}/documents`;
  const selection = { filename: 'Reselected plan.pdf', mimeType: 'application/pdf', size: pdf.length, clientSha256: createHash('sha256').update(pdf).digest('hex'), clientUploadId: randomUUID() };
  const cancelledIntent = await (await context.request.post(`${uploadBase}/upload-intent`, { headers: { Origin: base }, data: selection })).json();
  expect((await context.request.delete(`${uploadBase}/${cancelledIntent.document.id}`, { headers: { Origin: base } })).status()).toBe(200);
  expect((await context.request.post(`${uploadBase}/upload-intent`, { headers: { Origin: base }, data: selection })).status()).toBe(409);
  const newIntent = await (await context.request.post(`${uploadBase}/upload-intent`, { headers: { Origin: base }, data: { ...selection, clientUploadId: randomUUID() } })).json();
  expect(newIntent.document.id).not.toBe(cancelledIntent.document.id);
  expect((await context.request.put(cancelledIntent.upload.url, { data: pdf, headers: { 'content-type': 'application/pdf' } })).ok()).toBe(true);
  expect((await context.request.post(`${uploadBase}/${cancelledIntent.document.id}/finalise`, { headers: { Origin: base }, data: {} })).status()).toBe(404);
  expect((await context.request.put(newIntent.upload.url, { data: pdf, headers: { 'content-type': 'application/pdf' } })).ok()).toBe(true);
  const newFinalised = await context.request.post(`${uploadBase}/${newIntent.document.id}/finalise`, { headers: { Origin: base }, data: {} }); expect(newFinalised.ok()).toBe(true);
  const repeatedFinalised = await context.request.post(`${uploadBase}/${newIntent.document.id}/finalise`, { headers: { Origin: base }, data: {} });
  const reselectedDocumentId = (await newFinalised.json()).document.id;
  expect((await repeatedFinalised.json()).document.id).toBe(reselectedDocumentId);
  expect((await context.request.delete(`${base}/api/documents/${reselectedDocumentId}`, { headers: { Origin: base } })).status()).toBe(200);
  expect((await context.request.post(`${uploadBase}/${newIntent.document.id}/finalise`, { headers: { Origin: base }, data: {} })).status()).toBe(404);
  const afterRemoval = await context.request.post(`${uploadBase}/upload-intent`, { headers: { Origin: base }, data: { ...selection, clientUploadId: randomUUID() } }); expect(afterRemoval.status()).toBe(201);
  const afterRemovalIntent = await afterRemoval.json();
  expect((await context.request.delete(`${uploadBase}/${afterRemovalIntent.document.id}`, { headers: { Origin: base } })).status()).toBe(200);
  for (const width of [1440,1366,1024,390]) {
    await current.setViewportSize({ width, height: 900 });
    for (const [name, url] of [['overview', `/projects/${projectId}`], ['projects','/projects'], ['project-create','/projects/new'], ['upload',`/documents/upload?projectId=${projectId}`], ['finance','/finance']] as const) {
      await current.goto(url); await current.locator('main').waitFor();
      expect(await current.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name} overflows at ${width}`).toBe(true);
      await current.screenshot({ path: `output/playwright/workflow/screenshots/${name}-${width}.png`, fullPage: true });
    }
  }
  await current.goto(`/projects/${projectId}`);
  const removed = await context.request.delete(`${base}/api/automation-jobs/${jobId}/queue`, { headers: { Origin: base } }); expect(removed.status(), await removed.text()).toBe(200);
  const stranger = await browser.newContext();
  await stranger.request.post(`${base}/api/auth/register`, { headers: { Origin: base }, data: { name: 'Other fixture user', email: `workflow-other-${stamp}@example.test`, password: 'SyntheticFixture123!', organisationName: `Other isolated ${stamp}` } });
  expect((await stranger.request.get(`${base}/api/application-drafts/${draftId}`)).status()).toBe(404);
  await stranger.close(); expect(errors).toEqual([]);
  await fs.writeFile('output/workflow/browser-fixture.json', JSON.stringify({ projectId, draftId, jobId, email: `workflow-browser-${stamp}@example.test`, widths: [1440,1366,1024,390], transfers, verifications }, null, 2));
});
