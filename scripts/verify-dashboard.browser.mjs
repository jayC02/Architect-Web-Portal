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
const projects = page.getByRole('region', { name: 'Active projects' });
const rows = projects.locator('tbody tr');
const search = projects.getByRole('searchbox', { name: 'Search active projects' });
const attention = page.getByRole('region', { name: 'Needs attention' });
const deadlines = page.getByRole('region', { name: 'Upcoming deadlines' });
const ready = async () => { await rows.last().waitFor(); };
try {
  await page.goto(base); await ready();
  for (const [query, expected] of [['Blackhill', 'Blackhill Drive extension'], ['Alexander Reid', 'West End townhouse'], ['Loch Lomond', 'Lochside new build']]) {
    await search.fill(query);
    check(`Search matches ${query}`, await rows.count() === 1 && await rows.first().getByRole('link', { name: expected, exact: true }).isVisible());
  }
  await search.fill('No such project');
  await page.getByRole('heading', { name: 'No matching projects' }).waitFor();
  check('Unmatched searches offer recovery', await page.getByRole('button', { name: 'Clear filters', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  check('Clear filters restores projects', await rows.count() === 5);
  await page.getByRole('button', { name: 'Needs attention 2', exact: true }).click();
  check('Attention filter shows matching recent projects', await rows.count() === 2);
  await projects.getByRole('button', { name: 'All active', exact: true }).click();
  await attention.getByRole('button', { name: 'View all 5 items', exact: true }).click();
  check('Attention expansion reveals remaining items', await attention.getByRole('listitem').count() === 5);
  await attention.getByRole('button', { name: 'Show fewer', exact: true }).click();
  check('Attention collapse restores four items', await attention.getByRole('listitem').count() === 4);
  const rangeResponse = page.waitForResponse(response => response.url().includes('/api/dashboard/summary?deadlineRange=7'));
  await page.getByRole('combobox', { name: 'Deadline date range' }).selectOption('7'); await rangeResponse;
  await deadlines.getByText('Warrant response target', { exact: true }).waitFor({ state: 'hidden' });
  check('The seven-day list includes the overdue deadline', await deadlines.getByText('Submit revised drawings', { exact: true }).isVisible());
  check('Deadline range updates data and URL', new URL(page.url()).searchParams.get('deadlineRange') === '7');
  const resetResponse = page.waitForResponse(response => response.url().includes('/api/dashboard/summary?deadlineRange=14'));
  await page.getByRole('combobox', { name: 'Deadline date range' }).selectOption('14'); await resetResponse;
  const mutationResponse = page.waitForResponse(response => response.url().includes('/api/dashboard/summary'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('portal:mutation-success'))); await mutationResponse;
  check('Existing mutation event refreshes the overview', true);
  await page.getByRole('button', { name: 'Job queue (0)', exact: true }).click();
  await page.getByText('No jobs queued. Queue a prepared application to add it here.').waitFor();
  check('Existing job queue opens correctly', await page.getByText('No jobs queued. Queue a prepared application to add it here.').isVisible());
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
      const project = rows.first().getByRole('link', { name: 'Blackhill Drive extension', exact: true });
      const nextAction = rows.first().getByRole('link', { name: 'Review supporting documents', exact: true });
      await project.scrollIntoViewIfNeeded();
      check('The first project is reachable on mobile', await project.isVisible());
      await nextAction.scrollIntoViewIfNeeded();
      check('The first project action is reachable on mobile', await nextAction.isVisible());
      await page.evaluate(() => scrollTo(0, 0));
      const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
      const projectsLink = mobileNav.getByRole('link', { name: 'Projects', exact: true });
      check('Mobile navigation includes projects', await projectsLink.isVisible());
      await mobileNav.getByRole('link', { name: 'Today', exact: true }).focus();
      await page.keyboard.press('Tab');
      check('Mobile navigation reaches Projects with the keyboard', await projectsLink.evaluate(element => element === document.activeElement));
    }
  }
  check('Planning action total is preserved', await attention.locator('dl > div').first().innerText() === 'Planning actions\n3');
  check('Warrant action total is preserved', await attention.locator('dl > div').nth(1).innerText() === 'Warrant actions\n2');
  await page.goto(base + '?state=empty');
  await page.getByRole('heading', { name: 'Start your first application' }).waitFor();
  check('Empty practice has a create-project action', await projects.getByRole('link', { name: 'New application', exact: true }).isVisible());
  check('Empty attention state is clear', await attention.getByText('All clear for now.', { exact: true }).isVisible());
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
  check('Refresh failure retains previously loaded projects', await rows.count() === 5);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('alert').waitFor({ state: 'detached' });
  check('Retry recovers from a transient request failure', true);
  await page.unroute('**/api/dashboard/summary?**');
  await page.goto(base); await ready();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check('The dashboard remains usable with reduced motion', await search.isVisible());
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
