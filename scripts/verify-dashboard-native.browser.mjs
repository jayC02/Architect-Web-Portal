import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.DASHBOARD_PREVIEW_URL || 'http://127.0.0.1:4324';
const output = path.resolve('output/playwright/dashboard-native');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
const errors = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
const check = (name, value) => { assert.ok(value, name); checks.push(name); };
const ready = () => page.locator('.practice-project-table').waitFor();
const rows = () => page.locator('.practice-project-table tbody tr');
const search = () => page.getByRole('searchbox', { name: 'Search active projects' });
try {
  await page.goto(`${base}/dashboard`); await ready();
  check('Dashboard primary action opens AI-assisted application creation', await page.locator('.practice-page-heading .btn-primary').getAttribute('href') === '/applications/new');
  const summary = await page.evaluate(async () => (await fetch('/api/dashboard/summary?deadlineRange=14')).json());
  check('Real project count matches the API', await rows().count() === Math.min(summary.activeProjects, 6));
  check('Document approvals match actual records', (await page.locator('.practice-document-total').innerText()).includes(`${summary.documentOverview.reviewed} approved of ${summary.documentOverview.total}`));
  const native = await page.evaluate(() => ({
    font: getComputedStyle(document.body).fontFamily,
    ground: getComputedStyle(document.querySelector('main').parentElement.parentElement).backgroundColor,
    nav: getComputedStyle(document.querySelector('a.app-link-active')).backgroundColor,
    panel: getComputedStyle(document.querySelector('.practice-register')).backgroundColor,
    radius: getComputedStyle(document.querySelector('.practice-register')).borderRadius,
    button: getComputedStyle(document.querySelector('.practice-page-heading .btn')).borderRadius,
  }));
  await page.screenshot({ path: path.join(output, 'dashboard-desktop.png'), fullPage: true });
  await page.screenshot({ path: path.join(output, 'dashboard-desktop-viewport.png') });
  const project = summary.activeProjectSummaries[0];
  await search().fill(project.clientName || project.name);
  check('Search matches real client or project names', await rows().count() > 0);
  await page.getByRole('button', { name: 'Clear project search' }).click();
  await search().fill('No such project anywhere');
  await page.getByRole('heading', { name: 'No matching projects' }).waitFor();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  check('Empty search recovers', await rows().count() === Math.min(summary.activeProjects, 6));
  for (const phase of summary.pipeline) {
    await page.locator('.practice-pipeline-legend').getByRole('button', { name: new RegExp(`^${phase.label} `, 'i') }).click();
    const expected = phase.key === 'complete'
      ? [...summary.activeProjectSummaries, ...summary.completedProjectSummaries].filter(item => item.status === 'COMPLETED' || item.stage === 'COMPLETION').length
      : summary.activeProjectSummaries.filter(item => phase.key === 'lead' ? item.stage === 'LEAD' : phase.key === 'documents' ? ['SURVEY', 'DESIGN'].includes(item.stage) : phase.key === 'planning' ? item.stage === 'PLANNING' : ['BUILDING_WARRANT', 'CONSTRUCTION'].includes(item.stage)).length;
    check(`Pipeline ${phase.key} filters its entire phase`, await rows().count() === Math.min(expected, 6));
    check(`Pipeline ${phase.key} updates the URL`, new URL(page.url()).searchParams.get('projectPhase') === phase.key);
    await page.getByRole('button', { name: 'Clear stage filter' }).click();
  }
  await page.getByRole('button', { name: /^Needs attention \d/ }).click();
  check('Attention project filter uses actual workload', await rows().count() === Math.min(summary.activeProjectSummaries.filter(item => item.needsAttention).length, 6));
  await page.getByRole('button', { name: 'All active', exact: true }).click();
  if (summary.needsAttention.length > 3) {
    await page.getByRole('button', { name: `View all ${summary.needsAttention.length} items`, exact: true }).click();
    check('All attention items are accessible beyond the old ten-item limit', await page.locator('.practice-attention-item').count() === summary.needsAttention.length);
    await page.getByRole('button', { name: 'Show fewer items', exact: true }).click();
  }
  for (const range of [7, 30, 14]) {
    const response = page.waitForResponse(res => res.url().endsWith(`/api/dashboard/summary?deadlineRange=${range}`));
    await page.getByRole('combobox', { name: 'Deadline date range' }).selectOption(String(range)); await response;
    await page.waitForFunction(() => !document.querySelector('#upcoming-deadlines').getAttribute('aria-busy') || document.querySelector('#upcoming-deadlines').getAttribute('aria-busy') === 'false');
    check(`Deadline ${range}-day range updates URL and data`, new URL(page.url()).searchParams.get('deadlineRange') === String(range));
  }
  const review = page.locator('.practice-review-projects');
  if (summary.documentOverview.projects.length) await review.locator('summary').click();
  else check('Actual data with no pending documents shows the review empty state', await page.getByText('No documents are waiting for review.', { exact: true }).isVisible());
  const visibleDestinations = await page.locator('a[href]').evaluateAll(links => [...new Set(links.map(link => link.getAttribute('href')).filter(href => href?.startsWith('/') && !href.startsWith('//')))]);
  const destinations = [...new Set([...visibleDestinations, ...summary.needsAttention.map(item => item.href)])];
  const routeFiles = [];
  const readRoutes = async directory => { for (const entry of await fs.readdir(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); if (entry.isDirectory()) await readRoutes(file); else if (file.endsWith('.astro') || file.endsWith('.ts')) routeFiles.push(file.replaceAll('\\', '/').replace(/^src\/pages/, '').replace(/\.(astro|ts)$/, '').replace(/\/index$/, '') || '/'); } };
  await readRoutes('src/pages');
  for (const href of destinations) {
    const pathname = new URL(href, base).pathname;
    const matches = routeFiles.some(route => new RegExp(`^${route.replace(/\[\.\.\.[^\]]+\]/g, '.+').replace(/\[[^\]]+\]/g, '[^/]+')}/?$`).test(pathname));
    const publicFile = await fs.access(path.join('public', pathname)).then(() => true, () => false);
    check(`Visible link resolves: ${href}`, matches || publicFile);
  }
  if (summary.documentOverview.projects.length) {
    check('Document review opens the right project file workflow', await review.locator('a').first().getAttribute('href') === `/projects/${summary.documentOverview.projects[0].id}/files`);
    await review.locator('summary').click();
  }
  for (const id of ['active-projects', 'upcoming-deadlines', 'document-review', 'automation-status']) {
    await page.locator(`.practice-summary a[href="#${id}"]`).click();
    check(`Statistic navigates to ${id}`, new URL(page.url()).hash === `#${id}`);
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.getByRole('button', { name: /^Job queue/ }).click();
  check('Existing queue expands', await page.getByRole('button', { name: /^Job queue/ }).getAttribute('aria-expanded') === 'true');
  await page.keyboard.press('Escape');
  check('Queue closes with Escape', await page.getByRole('button', { name: /^Job queue/ }).getAttribute('aria-expanded') === 'false');
  await page.locator('.practice-calendar > summary').click();
  if (await page.getByRole('button', { name: 'Download & connect Agent', exact: true }).count()) {
    await page.route('**/api/settings/desktop-agents/setup', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Agent setup is disabled in this read-only test.' }) }));
    await page.getByRole('button', { name: 'Download & connect Agent', exact: true }).click();
    await page.getByText('Agent setup is disabled in this read-only test.', { exact: true }).waitFor();
    check('Existing Agent setup button preserves its workflow and error recovery', true);
    await page.unroute('**/api/settings/desktop-agents/setup');
  }
  await page.getByRole('button', { name: 'Next month', exact: true }).waitFor();
  for (const label of ['Next month', 'Previous month', 'Today']) {
    const response = page.waitForResponse(res => res.url().includes('/api/calendar?'));
    if (label === 'Today') await page.getByRole('button', { name: 'Next month', exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click(); await response;
    check(`Calendar ${label} works`, true);
  }
  await page.locator('.practice-calendar > summary').click();
  for (const width of [320, 390, 640, 768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    check(`${width}px has no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (width === 390) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, 'dashboard-mobile.png'), fullPage: true });
      check('Mobile uses the existing application navigation', await page.getByRole('navigation', { name: 'Mobile navigation' }).isVisible());
      await search().focus();
      check('Keyboard focus is visible', await search().evaluate(el => getComputedStyle(el).outlineStyle !== 'none'));
      await page.evaluate(() => scrollTo(0, 700));
      await page.waitForFunction(() => document.querySelector('[data-queue-position]')?.getAttribute('data-queue-position') === 'floating');
      check('Floating job queue stays below the existing mobile header', await page.getByRole('button', { name: /^Job queue/ }).evaluate(el => el.getBoundingClientRect().top >= document.querySelector('[data-mobile-navigation-header]').getBoundingClientRect().bottom));
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${base}/projects`);
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
  const sibling = await page.evaluate(() => ({ font: getComputedStyle(document.body).fontFamily, ground: getComputedStyle(document.querySelector('main').parentElement.parentElement).backgroundColor, nav: getComputedStyle(document.querySelector('a.app-link-active')).backgroundColor, panel: getComputedStyle(document.querySelector('.panel')).backgroundColor, radius: getComputedStyle(document.querySelector('.panel')).borderRadius, button: getComputedStyle(document.querySelector('main .btn')).borderRadius }));
  check('Dashboard typography, backgrounds, panels, radius and controls match Projects', JSON.stringify(native) === JSON.stringify(sibling));
  await page.screenshot({ path: path.join(output, 'projects-reference.png'), fullPage: true });
  // Use synthetic records only in browser memory to cover states absent from the real practice.
  const fixtures = { ...summary, activeProjects: 9,
    documentOverview: { ...summary.documentOverview, needsReview: 1, projects: [{ id: 'fixture-0', name: 'Fixture project 0', count: 1 }] },
    completedProjectSummaries: [{ ...project, id: 'fixture-completed', status: 'COMPLETED', stage: 'LEAD', nextAction: { label: 'View completed project', href: '/projects/fixture-completed' } }],
    pipeline: [{ key: 'lead', label: 'Lead', count: 0 }, { key: 'documents', label: 'Documents', count: 1 }, { key: 'planning', label: 'Planning', count: 8 }, { key: 'warrant', label: 'Building warrant', count: 0 }, { key: 'complete', label: 'Completion', count: 1 }],
    activeProjectSummaries: Array.from({ length: 9 }, (_, index) => ({ ...project, id: `fixture-${index}`, name: `Fixture project ${index}`, siteSummary: `Site ${index}`, clientName: `Client ${index}`, internalReference: `REF-${index}`, stage: index === 8 ? 'SURVEY' : 'PLANNING', needsAttention: index === 8, nextAction: { label: 'Open project', href: `/projects/fixture-${index}`, tone: 'neutral' } })),
    upcomingDeadlines: Array.from({ length: 6 }, (_, index) => ({ id: `fixture-deadline-${index}`, title: `Deadline ${index}`, dueDate: new Date().toISOString(), status: 'OVERDUE', project: { id: `fixture-${index}`, name: `Fixture project ${index}` } })),
  };
  let state = 'populated'; let fail = false; let delay = false;
  await page.route('**/api/dashboard/summary?**', async route => {
    if (delay) await new Promise(resolve => setTimeout(resolve, 1200));
    if (fail) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test connection interrupted.' }) });
    const range = Number(new URL(route.request().url()).searchParams.get('deadlineRange'));
    const data = state === 'empty' ? { ...fixtures, activeProjects: 0, activeProjectSummaries: [], completedProjectSummaries: [], needsAttention: [], upcomingDeadlines: [], pipeline: [], documentOverview: { total: 0, reviewed: 0, needsReview: 0, projects: [], statuses: [] } } : fixtures;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...data, deadlineRange: range }) });
  });
  await page.goto(`${base}/dashboard`); await ready();
  await review.locator('summary').click();
  check('Document review opens the right project file workflow with pending documents', await review.locator('a').first().getAttribute('href') === '/projects/fixture-0/files');
  await review.locator('summary').click();
  await page.getByRole('button', { name: 'Next project page' }).click();
  check('Pagination exposes projects after the sixth row', await rows().count() === 3);
  await page.getByRole('button', { name: 'Previous project page' }).click();
  check('Previous page restores the first six projects', await rows().count() === 6);
  for (const query of ['Fixture project 8', 'Client 8', 'Site 8', 'REF-8']) {
    await search().fill(query);
    check(`Search covers all records by ${query}`, await rows().count() === 1 && (await rows().innerText()).includes('Fixture project 8'));
  }
  await page.getByRole('button', { name: 'Clear project search' }).click();
  await page.getByRole('button', { name: 'Needs attention 1', exact: true }).click();
  check('Attention reaches a project outside the original first six', await rows().count() === 1);
  await page.getByRole('button', { name: 'All active', exact: true }).click();
  await page.locator('.practice-pipeline-legend').getByRole('button', { name: 'Completion 1', exact: true }).click();
  check('Completed projects remain accessible through the completion pipeline filter', await rows().count() === 1 && (await rows().innerText()).includes('Completed'));
  check('Completed status overrides an old lead-stage progress indicator', await page.getByRole('img', { name: 'Completed, workflow stage 5 of 5', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Clear stage filter' }).click();
  await page.getByRole('button', { name: 'View all 6 deadlines', exact: true }).click();
  check('Deadline expansion exposes every item', await page.locator('.practice-deadline-item').count() === 6);
  check('Stored overdue status cannot mark a future/today deadline overdue', await page.locator('.practice-deadline-item.is-overdue').count() === 0);
  check('Project deadline links target their own project', await page.locator('.practice-deadline-item').first().getAttribute('href') === '/projects/fixture-0#deadlines');
  await page.getByRole('button', { name: 'Show fewer deadlines', exact: true }).click();
  fail = true;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('portal:mutation-success')));
  await page.getByRole('alert').waitFor();
  check('Failed refresh preserves the previous projects', await rows().count() === 6);
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('alert').waitFor({ state: 'hidden' });
  check('Retry recovers from a failed refresh', true);
  fail = true;
  await page.reload(); await page.getByRole('alert').waitFor();
  check('Initial load failure offers recovery', await page.getByRole('button', { name: 'Try again', exact: true }).isVisible());
  fail = false; delay = true;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Loading your overview' }).waitFor();
  check('Loading state is visible during retry', await page.getByRole('status').filter({ hasText: 'Loading your overview' }).isVisible());
  await ready(); delay = false;
  delay = true;
  await page.getByRole('combobox', { name: 'Deadline date range' }).selectOption('7');
  await page.getByRole('combobox', { name: 'Deadline date range' }).selectOption('30');
  await page.waitForFunction(() => document.querySelector('.practice-metric:nth-child(2) p')?.textContent === 'Next 30 days + overdue');
  check('A fast range change cannot be overwritten by an older response', new URL(page.url()).searchParams.get('deadlineRange') === '30');
  delay = false;
  await page.goto(`${base}/dashboard?projectPhase=documents`); await ready();
  check('Stage filters survive direct navigation and reload', await rows().count() === 1 && (await rows().innerText()).includes('Fixture project 8'));
  state = 'empty'; await page.reload();
  await page.getByRole('heading', { name: 'Start your first application' }).waitFor();
  check('Empty dashboard prioritises AI-assisted application creation', await page.locator('.practice-empty').getByRole('link', { name: 'New application', exact: true }).getAttribute('href') === '/applications/new');
  check('Empty dashboard retains a clearly labelled manual fallback', await page.locator('.practice-empty').getByRole('link', { name: 'Manual project', exact: true }).getAttribute('href') === '/projects/new');
  check('Empty attention state is handled', await page.getByText('All clear for now', { exact: true }).isVisible());
  await page.route('**/api/auth/logout', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL('**/login');
  check('Existing sign-out control completes its navigation', true);
  check('No browser runtime errors', errors.length === 0);
  await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify({ checks, errors, native, sibling }, null, 2));
  console.log(`${checks.length} dashboard browser checks passed. Screenshots: ${output}`);
} finally { await browser.close(); }
