import { expect, test } from '@playwright/test';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4321';

test('primary navigation is simplified across desktop, secondary routes and mobile', async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/register`);
  await page.getByLabel('Your name').fill('Navigation Tester');
  await page.getByLabel('Organisation').fill(`Navigation Practice ${stamp}`);
  await page.getByLabel('Email').fill(`navigation-${stamp}@example.test`);
  await page.getByLabel('Password').fill('ChangeMe123!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const desktopShell = page.locator('aside');
  const primaryNavigation = desktopShell.getByRole('navigation', { name: 'Primary navigation' });
  await expect(primaryNavigation.getByRole('link')).toHaveText(['Today', 'Projects', 'Calendar', 'Finance']);
  await expect(desktopShell.getByRole('link', { name: 'New application' })).toBeVisible();
  await expect(desktopShell.getByRole('navigation', { name: 'Secondary navigation' }).getByRole('link')).toHaveText(['Settings']);
  for (const removed of ['Clients', 'Sites', 'Deadlines', 'Email Updates']) {
    await expect(primaryNavigation.getByRole('link', { name: removed, exact: true })).toHaveCount(0);
  }

  await page.goto(`${baseUrl}/projects`);
  await expect(page.getByRole('navigation', { name: 'Project directories' }).getByRole('link')).toHaveText(['Clients', 'Sites']);

  for (const [path, parent] of [
    ['/clients', 'Projects'],
    ['/sites', 'Projects'],
    ['/deadlines', 'Calendar'],
    ['/email-updates', 'Today'],
    ['/settings/practice', 'Settings'],
  ] as const) {
    const response = await page.goto(`${baseUrl}${path}`);
    expect(response?.status()).toBeLessThan(400);
    await expect(desktopShell.getByRole('link', { name: parent, exact: true })).toHaveAttribute('aria-current', 'page');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/dashboard`);
  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNavigation.getByRole('link')).toHaveText(['Today', 'Projects', 'Calendar', 'Finance', 'Settings']);
  await expect(page.locator('header').getByRole('link', { name: 'New application' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
});
