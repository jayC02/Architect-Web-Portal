import { expect, test } from '@playwright/test';
import {
  AutomationJobSourceType,
  AutomationJobStatus,
  AutomationJobType,
  PlanningStatus,
  ProjectStage,
} from '@prisma/client';
import { prisma } from '../src/lib/db/prisma';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4321';
const stamp = Date.now();
const email = `submission-dialog-${stamp}@example.test`;
const password = 'ChangeMe123!';
let organisationId: string | undefined;
let userId: string | undefined;

test.afterAll(async () => {
  if (organisationId) await prisma.organisation.deleteMany({ where: { id: organisationId } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

test('prepared submission dialog is accessible, single-flight and yields canonical waiting state', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/register`);
  await page.getByLabel('Your name').fill('Submission Dialog Tester');
  await page.getByLabel('Organisation').fill(`Submission Dialog Practice ${stamp}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, organisationLinks: { take: 1, select: { organisationId: true } } },
  });
  userId = user.id;
  organisationId = user.organisationLinks[0]?.organisationId;
  expect(organisationId).toBeTruthy();

  const project = await prisma.project.create({
    data: {
      organisationId: organisationId!,
      name: `Prepared Planning ${stamp}`,
      stage: ProjectStage.PLANNING,
      siteAddress: '1 Browser Test Street, Edinburgh',
    },
  });
  const application = await prisma.planningApplication.create({
    data: {
      organisationId: organisationId!,
      projectId: project.id,
      status: PlanningStatus.DRAFTING,
      description: 'Browser-tested prepared application',
    },
  });
  await prisma.automationJob.create({
    data: {
      organisationId: organisationId!,
      projectId: project.id,
      createdById: user.id,
      sourceType: AutomationJobSourceType.PROJECT,
      type: AutomationJobType.HOUSEHOLDER_PLANNING,
      status: AutomationJobStatus.COMPLETED,
      title: 'Prepared Planning browser test',
      dataSnapshot: {
        project: { id: project.id },
        planningApplication: { id: application.id },
      },
      documentSnapshot: { documents: [] },
      resultSummary: 'Application prepared',
      lastCheckpoint: 'final_review',
      completedAt: new Date(),
    },
  });

  await page.goto(`${baseUrl}/projects/${project.id}`);
  await expect(page.getByRole('heading', { name: 'Prepared — needs your review' })).toBeVisible();
  const markButton = page.getByRole('button', { name: 'Mark as submitted' });
  await markButton.click();
  const dialog = page.getByRole('dialog', { name: 'Confirm submission' });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBeTruthy();

  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(markButton).toBeFocused();

  let interceptedRequests = 0;
  const endpointPattern = `**/api/planning/${application.id}/mark-submitted`;
  await page.route(endpointPattern, async (route) => {
    interceptedRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Browser test submission failure.' }),
    });
  });
  await markButton.click();
  const confirmButton = dialog.getByRole('button', { name: 'Confirm submitted' });
  await confirmButton.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(dialog.getByRole('alert')).toHaveText('Browser test submission failure.');
  expect(interceptedRequests).toBe(1);
  await page.unroute(endpointPattern);

  await Promise.all([
    page.waitForEvent('framenavigated', {
      predicate: (frame) => frame === page.mainFrame(),
      timeout: 60_000,
    }),
    confirmButton.click(),
  ]);
  await expect(page.getByRole('heading', { name: 'Submitted — waiting for council' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Mark as submitted' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();

  const saved = await prisma.planningApplication.findUniqueOrThrow({ where: { id: application.id } });
  expect(saved.status).toBe(PlanningStatus.SUBMITTED);
  expect(saved.submissionDate).not.toBeNull();
  expect(await prisma.lifecycleEvent.count({
    where: { organisationId: organisationId!, idempotencyKey: `planning:${application.id}:submitted` },
  })).toBe(1);
});
