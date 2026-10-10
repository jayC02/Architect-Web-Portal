import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { prisma } from '../src/lib/db/prisma';
assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get('schema'), 'workflow_overhaul_preview_20261009');
assert.equal(process.env.DOCUMENT_PROCESSING_ENABLED, 'false');
assert.equal(process.env.DOCUMENT_AI_PROVIDER, 'gemini');

// Valid, one-page PDFs with text and simple vector drawings. No customer files.
const pdf = (title: string, lines: string[], drawing = false) => {
  const escape = (value: string) => value.replace(/[\\()]/g, character => `\\${character}`);
  const stream = `BT /F1 14 Tf 40 790 Td (${escape(title)}) Tj /F1 11 Tf ${lines.map(line => `0 -22 Td (${escape(line)}) Tj`).join(' ')} ET\n${drawing ? '0.8 0 0 RG 2 w 100 100 240 180 re S 100 100 m 340 280 l S' : ''}`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let content = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(content)); content += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(content);
};
const base = 'http://127.0.0.1:4330';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ baseURL: base, reducedMotion: 'reduce' });
  const email = `live-ai-${randomUUID()}@example.test`;
  const registration = await context.request.post('/api/auth/register', { headers: { Origin: base }, data: { name: 'Live synthetic AI verification', email, password: 'SyntheticFixture123!', organisationName: `Live synthetic AI ${randomUUID()}` } });
  assert.equal(registration.status(), 201, await registration.text());
  const member = await prisma.organisationMember.findFirstOrThrow({ where: { user: { email } } });
  await prisma.organisationDefaults.upsert({ where: { organisationId: member.organisationId }, update: {}, create: { organisationId: member.organisationId, practiceName: 'Synthetic Verification Architects', agentFirstName: 'Jane', agentLastName: 'Architect', agentEmail: 'agent@example.test', agentPhone: '07483882299', agentBuildingNumber: '10', agentAddressLine1: 'Office Street', agentTownCity: 'Glasgow', agentPostcode: 'G1 1AA' } });
  const site = ['Site: 147 High Street, Glasgow, G1 1AA', 'Local authority: Glasgow City Council'];
  const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let transfers = 0, requests = 0;
  page.on('request', request => { if (request.method() === 'PUT' && request.url().startsWith('http://127.0.0.1:4331')) transfers++; if (request.method() === 'POST' && request.url().endsWith('/analyse')) requests++; });
  await page.goto('/applications/new'); await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-file-input]')).toBeEnabled({ timeout: 30_000 });
  await page.locator('[data-file-input]').setInputFiles([
    { name: 'Location Plan.pdf', mimeType: 'application/pdf', buffer: pdf('LOCATION PLAN', [...site, 'Drawing number LP-101 Revision A', 'Scale 1:1250; red line denotes the application site'], true) },
    { name: 'Proposed Plans.pdf', mimeType: 'application/pdf', buffer: pdf('PROPOSED GROUND FLOOR PLAN', [...site, 'Drawing number PP-101 Revision A', 'Construction of a single-storey rear extension', 'Type of work: domestic alteration and extension; Scale 1:100'], true) },
    { name: 'Supporting Statement.pdf', mimeType: 'application/pdf', buffer: pdf('CLIENT BRIEF AND SUPPORTING STATEMENT', [...site, 'Project: 147 High Street extension', 'Applicant: Ms Anna Campbell (individual)', 'Email: anna@example.test', 'Phone: 07483882299', 'Applicant address is the same as the site address.', 'Proposal: Construction of a single-storey rear extension.']) },
  ]);
  await page.locator('select[name=applicationType]').selectOption('HOUSEHOLDER_PLANNING');
  await page.locator('textarea[name=notes]').fill('Rear domestic extension');
  await page.locator('[data-submit]').click();
  await page.waitForURL(/\/applications\/(?!new)[^/]+$/, { timeout: 180_000 });
  const id = page.url().split('/').at(-1)!;
  let draft: any;
  await expect.poll(async () => { draft = (await (await context.request.get(`/api/application-drafts/${id}`)).json()).draft; return draft.status; }, { timeout: 180_000, intervals: [1500,3000] }).toMatch(/NEEDS_REVIEW|READY_TO_CREATE/);
  assert.equal(transfers, 3); assert.equal(draft.processingMode, 'inline');
  assert.deepEqual(draft.documents.map((document: any) => document.analysisStatus), ['SUCCESS', 'SUCCESS', 'SUCCESS']);
  assert.equal(draft.review.client.firstName, 'Anna'); assert.equal(draft.review.client.lastName, 'Campbell');
  assert.equal(draft.review.client.email, 'anna@example.test');
  assert.equal(draft.review.site.buildingNumber, '147'); assert.equal(draft.review.site.addressLine1, 'High Street');
  assert.equal(draft.review.site.postcode.replace(/\s/g, ''), 'G11AA');
  assert.equal(draft.documents[0].documentType, 'LOCATION_PLAN'); assert.equal(draft.documents[1].documentType, 'PROPOSED_DRAWING');
  assert.match(draft.review.application.description, /extension/i);
  assert.deepEqual(errors, []);
  await fs.mkdir('output/workflow/hobby', { recursive: true });
  await page.screenshot({ path: 'output/workflow/hobby/live-gemini-review.png', fullPage: true });
  const records = await prisma.applicationDraftDocument.findMany({ where: { draftId: id }, select: { originalFilename: true, analysisStatus: true, analysisProvider: true, analysisModel: true, documentType: true } });
  await fs.writeFile('output/workflow/hobby/live-ai-results.json', JSON.stringify({ id, transfers, requests, provider: 'gemini', storage: 'loopback fixture', processingEnabled: false, documents: records, client: draft.review.client, site: draft.review.site, description: draft.review.application.description }, null, 2));
  console.log(`Live Gemini upload -> analysis -> preparation -> review passed: 3 PDFs, ${requests} bounded requests, 3 transfers.`);
  await context.close();
} finally { await browser.close(); await prisma.$disconnect(); }
