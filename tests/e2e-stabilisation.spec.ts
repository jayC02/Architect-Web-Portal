import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseUrl = 'http://127.0.0.1:4321';
const stamp = Date.now();
const email = `stabilise-${stamp}@example.test`;
const password = 'ChangeMe123!';
const projectName = `Stabilisation Project ${stamp}`;
const fixtureDir = path.join(process.cwd(), 'output', 'playwright');
const samplePdf = path.join(fixtureDir, 'sample.pdf');
const locationPlanPdf = path.join(fixtureDir, 'site-location-plan-p01.pdf');
const proposedPlanPdf = path.join(fixtureDir, 'proposed-floor-plan-p02.pdf');
const miscPdf = path.join(fixtureDir, 'misc-upload.pdf');

test.beforeAll(async () => {
  await fs.mkdir(fixtureDir, { recursive: true });
  const pdfishBytes = Buffer.from('%PDF-1.4\n% Architect Web Portal test fixture\n%%EOF\n');
  await fs.writeFile(samplePdf, pdfishBytes);
  await fs.writeFile(locationPlanPdf, pdfishBytes);
  await fs.writeFile(proposedPlanPdf, pdfishBytes);
  await fs.writeFile(miscPdf, pdfishBytes);
});

test('MVP stabilisation flow', async ({ page }) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto(`${baseUrl}/dashboard`);
  await expect(page).toHaveURL(/\/login$/);

  await page.goto(`${baseUrl}/register`);
  await page.getByLabel('Your name').fill('Stabilisation Tester');
  await page.getByLabel('Organisation').fill(`Stabilisation Practice ${stamp}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto(`${baseUrl}/clients`);
  await page.getByLabel('Name').first().fill(`Client ${stamp}`);
  await page.getByLabel('Email').first().fill(`client-${stamp}@example.test`);
  await page.getByLabel('Phone').first().fill('0131 000 0000');
  await page.getByRole('button', { name: 'Save client' }).first().click();
  await expect(page.getByText(`Client ${stamp}`).first()).toBeVisible();

  await page.getByText(`Client ${stamp}`).last().click();
  await page.getByLabel('Phone').last().fill('0131 111 1111');
  await page.getByRole('button', { name: 'Save client' }).last().click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto(`${baseUrl}/sites`);
  await page.getByLabel('Address line 1').first().fill(`${stamp} Test Street`);
  await page.getByLabel('Town/city').first().fill('Edinburgh');
  await page.getByLabel('Postcode').first().fill('EH1 1AA');
  await page.getByLabel('Local authority').first().fill('City of Edinburgh Council');
  await page.getByRole('button', { name: 'Save site' }).first().click();
  await expect(page.getByText(`${stamp} Test Street`).first()).toBeVisible();

  await page.goto(`${baseUrl}/projects/new`);
  await page.getByLabel('Project name').fill(projectName);
  await page.getByLabel('Internal reference').fill(`ST-${stamp}`);
  await page.getByLabel('Project type').fill('Domestic extension');
  await page.getByLabel('Client').selectOption({ label: `Client ${stamp}` });
  await page.getByLabel('Linked site').selectOption({ label: `${stamp} Test Street, EH1 1AA` });
  await page.getByLabel('Local authority').fill('City of Edinburgh Council');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText(projectName)).toBeVisible();

  await page.getByRole('link', { name: projectName }).click();
  await page.getByLabel('Project type').fill('Retrofit assessment');
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto(`${baseUrl}/documents`);
  await expect(page.getByRole('heading', { name: 'Project folders' })).toBeVisible();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  await page.getByRole('link', { name: 'Upload documents' }).first().click();
  await expect(page).toHaveURL(/\/documents\/upload/);
  await page.locator('[data-documents-project-select]').selectOption({ label: `${projectName} - ST-${stamp}` });
  await page.locator('[data-documents-upload-form] input[type="file"]').setInputFiles([locationPlanPdf, proposedPlanPdf, miscPdf]);
  await page.locator('[data-documents-upload-form]').getByRole('button', { name: 'Upload and review sorting' }).click();
  await expect(page).toHaveURL(/\/files\/sort\//);
  await expect(page.getByRole('heading', { name: 'Review file sorting' })).toBeVisible();
  await expect(page.getByText('site-location-plan-p01.pdf')).toBeVisible();
  await expect(page.getByText('proposed-floor-plan-p02.pdf')).toBeVisible();
  await expect(page.getByText('misc-upload.pdf')).toBeVisible();
  await expect(page.getByLabel('Accept sorting suggestion for misc-upload.pdf')).not.toBeChecked();
  await page.getByRole('button', { name: 'Accept all high confidence' }).click();
  await expect(page.getByLabel('Accept sorting suggestion for misc-upload.pdf')).not.toBeChecked();
  await page.getByRole('button', { name: 'Save reviewed sorting' }).click();
  await expect(page).toHaveURL(/\/documents\/projects\//);
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  await expect(page.getByRole('link', { name: 'site-location-plan-p01.pdf' })).toBeVisible();

  await page.getByRole('link', { name: 'Project files page' }).click();
  await expect(page).toHaveURL(/\/files$/);

  await page.getByLabel('File').setInputFiles(samplePdf);
  await page.getByLabel('Document type').first().selectOption('LOCATION_PLAN');
  await page.getByLabel('Revision').first().fill('P01');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByRole('link', { name: 'sample.pdf' })).toBeVisible();
  const newestClassification = page.locator('details').first();
  await newestClassification.getByText('Edit classification').click();
  await newestClassification.getByLabel('Document type').selectOption('EXISTING_DRAWING');
  await newestClassification.getByRole('button', { name: 'Save classification' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto(`${baseUrl}/projects`);
  await page.getByRole('link', { name: projectName }).click();
  await page.getByRole('link', { name: 'Planning' }).click();
  await page.getByLabel('Application reference').first().fill(`PLAN-${stamp}`);
  await page.getByLabel('Status').first().selectOption('SUBMITTED');
  await page.getByRole('button', { name: 'Save planning record' }).first().click();
  await expect(page.getByText(`PLAN-${stamp}`)).toBeVisible();
  await page.getByText('Edit planning record').click();
  await page.getByLabel('Status').last().selectOption('VALIDATED');
  await page.getByRole('button', { name: 'Save planning record' }).last().click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto(`${baseUrl}/projects`);
  await page.getByRole('link', { name: projectName }).click();
  await page.getByRole('link', { name: 'Building warrant' }).click();
  await page.getByLabel('Warrant reference').first().fill(`BW-${stamp}`);
  await page.getByLabel('Status').first().selectOption('SUBMITTED');
  await page.getByRole('button', { name: 'Save warrant record' }).first().click();
  await expect(page.getByText(`BW-${stamp}`)).toBeVisible();
  await page.getByText('Edit warrant record').click();
  await page.getByLabel('Status').last().selectOption('IN_REVIEW');
  await page.getByRole('button', { name: 'Save warrant record' }).last().click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto(`${baseUrl}/deadlines`);
  await page.getByLabel('Title').first().fill(`Deadline ${stamp}`);
  await page.getByLabel('Linked project').first().selectOption({ label: projectName });
  await page.getByLabel('Due date').first().fill('2026-07-01');
  await page.getByLabel('Type').first().selectOption('CLIENT_ACTION');
  await page.getByRole('button', { name: 'Save deadline' }).first().click();
  await expect(page.getByText(`Deadline ${stamp}`)).toBeVisible();
  await page.getByText('Edit deadline').click();
  await page.getByLabel('Priority').last().selectOption('HIGH');
  await page.getByRole('button', { name: 'Save deadline' }).last().click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto(`${baseUrl}/dashboard`);
  await expect(page.getByRole('heading', { name: 'Practice dashboard' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/projects`);
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/projects`);
  await page.getByRole('link', { name: projectName }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete project' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText(projectName)).toHaveCount(0);

  await page.goto(`${baseUrl}/clients`);
  await page.getByText(`Client ${stamp}`).last().click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete client' }).last().click();
  await expect(page.getByText(`Client ${stamp}`)).toHaveCount(0);

  await page.goto(`${baseUrl}/sites`);
  await page.getByText(`${stamp} Test Street`).last().click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete site' }).last().click();
  await expect(page.getByText(`${stamp} Test Street`)).toHaveCount(0);

  await page.locator('[data-logout]').first().click();
  await expect(page).toHaveURL(/\/login$/);

  expect(consoleErrors.filter((message) => !message.includes('favicon'))).toEqual([]);
});
