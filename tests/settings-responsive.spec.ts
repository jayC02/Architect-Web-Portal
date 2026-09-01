import { expect, test } from '@playwright/test';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4321';

test('simplified Settings and contextual Agent setup work at desktop and mobile sizes', async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const certifierName = `Responsive Certifier ${stamp}`;

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/register`);
  await page.getByLabel('Your name').fill('Settings Tester');
  await page.getByLabel('Organisation').fill(`Settings Practice ${stamp}`);
  await page.getByLabel('Email').fill(`settings-${stamp}@example.test`);
  await page.getByLabel('Password').fill('ChangeMe123!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
  await expect(page.getByRole('complementary', { name: 'Desktop automation setup' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Download & connect Agent' })).toBeVisible();

  await page.goto(`${baseUrl}/settings`);
  for (const name of ['Practice', 'Certifiers', 'Integrations', 'Preferences']) {
    await expect(page.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await expect(page.getByText('Desktop job history')).toHaveCount(0);
  await expect(page.getByText('Automatic workflow reminders')).toHaveCount(0);

  await page.getByRole('link', { name: /^Practice/ }).click();
  await expect(page.getByRole('heading', { name: 'Practice details' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Default application contact' })).toBeVisible();
  await page.getByLabel('First name').fill('Alex');
  await page.getByLabel('Last name').fill('Architect');
  await page.getByLabel('Email').fill(`alex-${stamp}@example.test`);
  await page.getByRole('button', { name: 'Save practice details' }).click();
  await expect(page.getByText('Practice settings saved.')).toBeVisible();

  await page.goto(`${baseUrl}/settings/certifiers`);
  await page.getByRole('button', { name: 'Add certifier' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Saved name').fill(certifierName);
  await dialog.getByLabel('Certifier name').fill('Chris Pattison');
  await dialog.getByLabel('Scheme type').fill('SER');
  await dialog.getByLabel('Registration A prefix').selectOption('SER1');
  await dialog.getByLabel('Registration A number').fill('01650');
  await dialog.getByLabel('Use as organisation default').check();
  await dialog.getByRole('button', { name: 'Add certifier' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Chris Pattison')).toBeVisible();
  await expect(page.getByText('Default', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/settings`);
  const settingsLinks = page.locator('nav[aria-label="Settings areas"] > a');
  await expect(settingsLinks).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await expect(settingsLinks.nth(index)).toHaveCSS('width', await settingsLinks.first().evaluate((element) => getComputedStyle(element).width));
  }

  await page.goto(`${baseUrl}/settings/certifiers`);
  await page.getByRole('button', { name: `Edit Chris Pattison` }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const dialogBox = await page.getByRole('dialog').boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.width).toBeLessThanOrEqual(390);
  expect(dialogBox!.height).toBeLessThanOrEqual(844);
  await page.getByRole('button', { name: 'Close certifier editor' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await page.goto(`${baseUrl}/settings/integrations`);
  await expect(page.getByRole('button', { name: 'Download & connect Agent' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View automation history' })).toBeVisible();
});
