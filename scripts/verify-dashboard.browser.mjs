import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.DASHBOARD_PREVIEW_URL || 'http://127.0.0.1:4322/dashboard';
const output = path.resolve('output/dashboard-preview');
const review = path.resolve('.impeccable/review');
await fs.mkdir(review, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
const check = (name, value) => { assert.ok(value, name); checks.push(name); };
const ready = async () => { await page.getByRole('heading', { name: 'Active projects 5', exact: true }).waitFor(); };
try {
  await page.goto(base); await ready();
  for (const [query, expected] of [['Blackhill', 'Blackhill Drive extension'], ['Alexander Reid', 'West End townhouse'], ['Loch Lomond', 'Lochside new build']]) {
    await page.getByRole('searchbox', { name: 'Search shown projects' }).fill(query);
    check(`Search matches ${query}`, await page.locator('.practice-project-table tbody tr').count() === 1 && await page.locator('.practice-project-name').innerText() === expected);
  }
  await page.getByRole('searchbox').fill('No such project');
  await page.getByRole('heading', { name: 'No matching projects' }).waitFor();
  check('Unmatched searches offer recovery', await page.getByRole('button', { name: 'Clear filters', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  check('Clear filters restores projects', await page.locator('.practice-project-table tbody tr').count() === 5);
  await page.getByRole('button', { name: 'Needs attention 2', exact: true }).click();
  check('Attention filter shows matching recent projects', await page.locator('.practice-project-table tbody tr').count() === 2);
  await page.getByRole('button', { name: 'All projects', exact: true }).click();
  await page.getByRole('button', { name: 'View all 4 items', exact: true }).click();
  check('Attention expansion reveals remaining items', await page.locator('.practice-attention-item').count() === 4);
  await page.getByRole('button', { name: 'Show fewer items', exact: true }).click();
  const rangeResponse = page.waitForResponse(response => response.url().includes('/api/dashboard/summary?deadlineRange=7'));
  await page.getByRole('combobox', { name: 'Deadline date range' }).selectOption('7'); await rangeResponse;
  await page.waitForFunction(() => document.querySelectorAll('.practice-deadline-item').length === 3);
  check('Deadline range updates data and URL', new URL(page.url()).searchParams.get('deadlineRange') === '7');
  const resetResponse = page.waitForResponse(response => response.url().includes('/api/dashboard/summary?deadlineRange=14'));
  await page.getByRole('combobox', { name: 'Deadline date range' }).selectOption('14'); await resetResponse;
  const mutationResponse = page.waitForResponse(response => response.url().includes('/api/dashboard/summary'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('portal:mutation-success'))); await mutationResponse;
  check('Existing mutation event refreshes the overview', true);
  await page.getByRole('button', { name: 'Job queue (0)', exact: true }).click();
  await page.getByText('No jobs queued. Queue a prepared application to add it here.').waitFor();
  check('Existing job queue opens correctly', await page.locator('[data-queue-position]').getAttribute('data-queue-position') === 'inline');
  await page.getByRole('button', { name: 'Job queue (0)', exact: true }).click();
  await page.locator('.practice-calendar > summary').click();
  await page.getByRole('button', { name: 'Next month', exact: true }).waitFor();
  const nextMonth = page.waitForResponse(response => response.url().includes('/api/calendar?month='));
  await page.getByRole('button', { name: 'Next month', exact: true }).click(); await nextMonth;
  check('Practice calendar loads and changes month', true);
  await page.locator('.practice-calendar > summary').click();
  for (const width of [320, 390, 768, 1024, 1280, 1440, 1600, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    check(`${width}px layout has no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (width === 390) {
      await page.evaluate(() => scrollTo(0, 0));
      check('Mobile first project and its next action fit in the first viewport', await page.locator('.practice-project-table tbody tr').first().evaluate(row => { const name = row.querySelector('.practice-project-name').getBoundingClientRect(), stage = row.querySelector('.practice-stage-badge').getBoundingClientRect(), action = row.querySelector('.practice-project-action > a').getBoundingClientRect(); return [name, stage, action].every(rect => rect.top >= 0 && rect.bottom <= 844); }));
      await page.locator('.practice-mobile-menu > summary').focus();
      await page.keyboard.press('Enter');
      check('Mobile navigation opens with the keyboard', await page.locator('.practice-mobile-menu').getAttribute('open') !== null);
      check('Mobile navigation includes projects', await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Projects', exact: true }).isVisible());
      await page.locator('.practice-mobile-menu > summary').click();
    }
  }
  check('Planning action total is preserved', await page.locator('.practice-workload > div').first().innerText() === 'Planning actions\n3');
  check('Warrant action total is preserved', await page.locator('.practice-workload > div').nth(1).innerText() === 'Warrant actions\n2');
  await page.goto(base + '?state=empty');
  await page.getByRole('heading', { name: 'Your next project starts here' }).waitFor();
  check('Empty practice has a create-project action', await page.locator('.practice-empty').getByRole('link', { name: 'Create project' }).isVisible());
  check('Empty attention state is clear', await page.getByText('All clear for now', { exact: true }).isVisible());
  await page.goto(base + '?state=error');
  await page.getByRole('alert').waitFor();
  check('Initial request failure offers retry', await page.getByRole('button', { name: 'Try again', exact: true }).isVisible());
  await page.goto(base); await ready();
  let failOnce = true;
  await page.route('**/api/dashboard/summary?**', async route => {
    if (failOnce) { failOnce = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary preview error' }) }); }
    else await route.continue();
  });
  await page.getByRole('combobox', { name: 'Deadline date range' }).selectOption('30');
  await page.getByRole('alert').waitFor();
  check('Refresh failure retains previously loaded projects', await page.locator('.practice-project-table tbody tr').count() === 5);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('alert').waitFor({ state: 'detached' });
  check('Retry recovers from a transient request failure', true);
  await page.unroute('**/api/dashboard/summary?**');
  await page.goto(base); await ready();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check('Reduced-motion preference disables loading animation', await page.evaluate(() => { const el = document.createElement('div'); el.className = 'practice-skeleton-summary'; document.querySelector('.practice-shell').append(el); const result = getComputedStyle(el).animationName === 'none'; el.remove(); return result; }));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); });
  await page.screenshot({ path: path.join(review, 'desktop.png'), fullPage: true });
  await page.screenshot({ path: path.join(output, 'dashboard-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); });
  await page.screenshot({ path: path.join(review, 'mobile.png'), fullPage: true });
  await page.screenshot({ path: path.join(output, 'dashboard-mobile.png'), fullPage: true });
  check('No browser runtime errors', errors.length === 0);
  const result = { passed: checks.length, checks, browserErrors: errors, preview: base, data: 'Isolated illustrative fixture data; no live records accessed.' };
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
