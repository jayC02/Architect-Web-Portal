import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { dev } from 'astro';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import { chromium } from 'playwright';

// Render the real Astro cards and hydrated React status controls in an isolated
// Astro project. No middleware, database, credentials or government portal calls.
const root = process.cwd();
const output = path.resolve('output/application-card-layout');
const pages = path.join(output, 'src/pages');
await fs.mkdir(pages, { recursive: true });
const projectPage = await fs.readFile('src/pages/projects/[id].astro', 'utf8');
const gridClass = projectPage.match(/<div class="([^"]*)">\s*<ApplicationSummaryCard/)?.[1];
assert.ok(gridClass, 'Use the actual project page applications grid');
const baseJob = {
  id: 'layout-planning', projectId: 'layout-project', type: 'HOUSEHOLDER_PLANNING', status: 'READY',
  executionAuthorisedAt: null, progressStage: null, progressStageState: null, progressPercent: null, etaSeconds: null,
  progressMessage: null, resultSummary: null, error: null, resultData: null, lastCheckpoint: null, stale: false,
  agentHeartbeatAt: null, dataSnapshot: {}, documentSnapshot: {}, payloadVersion: 2, preparedAt: null,
  claimedAt: null, agentRunId: null, progressUpdatedAt: null, completedAt: null,
  createdAt: '2026-10-22T10:00:00Z', updatedAt: '2026-10-22T10:00:00Z',
};
const records = {
  failed: { ...baseJob, status: 'FAILED_RETRYABLE', lastCheckpoint: 'address_selection',
    error: 'Architect Pro could not safely resolve the property address returned by the portal.',
    resultData: { errorCode: 'ADDRESS_RESOLUTION_FAILED', stageDescription: 'Selecting the property address', recoveryAction: 'review_address' } },
  ready: baseJob,
  active: { ...baseJob, status: 'IN_PROGRESS', progressStage: 'documents', progressPercent: 42, progressMessage: 'Uploading supporting documents' },
  review: { ...baseJob, status: 'COMPLETED' },
  submitted: { ...baseJob, status: 'COMPLETED' },
};
const longError = 'The application could not be prepared. ' + 'unbroken-diagnostic-token'.repeat(32);
await fs.writeFile(path.join(pages, 'index.astro'), `---
export const prerender = false;
import Card from '@/components/projects/ApplicationSummaryCard.astro';
import '@/styles/global.css';
const records = ${JSON.stringify(records)};
const mode = Astro.url.searchParams.get('state') ?? 'failed';
const mirror = Astro.url.searchParams.has('mirror');
const long = Astro.url.searchParams.has('long');
const job = records[mode] ?? null;
if (job?.executionAuthorisedAt) job.executionAuthorisedAt = new Date(job.executionAuthorisedAt);
const context = { client: null, site: { id: 'fixture-site', addressLine1: 'Blackhill Drive', buildingNumber: '147', townCity: 'Glasgow', postcode: 'G23 5NN' }, applicationId: 'fixture-application', documentsHref: '#documents', portalHref: null, typeOfWorkKeys: [], typeOfWorkOptions: [], agentDefaults: null, organisationName: 'Fixture Practice', canManageAgentDefaults: false };
const common = { address: long ? 'LongUnbrokenAddress'.repeat(30) : '147, Blackhill Drive, Glasgow, G23 5NN', clientName: long ? 'LongUnbrokenClient'.repeat(25) : 'Prestige Properties Highland Ltd.', applicationType: 'Householder', status: 'Drafting', documentCount: 6, reference: 'Not assigned', projectId: 'layout-project', applicationStatus: mode === 'submitted' ? 'SUBMITTED' : 'DRAFTING', connectedAgent: true, recoveryContext: context };
---
<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Application card layout fixture</title><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body><main class="mx-auto max-w-7xl p-4"><h1 class="mb-4 text-2xl font-semibold">Applications</h1>
<div class=${JSON.stringify(gridClass)}>
  <Card {...common} id="planning" title="Planning" subtitle="Latest planning application" manageHref="#planning" applicationKind="PLANNING" applicationId="fixture-planning" desktopJob={mirror ? null : job} desktopMissingCount={10} />
  <Card {...common} id="building-warrant" title="Building Warrant" subtitle="Latest building warrant application" manageHref="#building-warrant" applicationKind="BUILDING_WARRANT" applicationType="Building Warrant" applicationId="fixture-warrant" desktopJob={mirror && job ? { ...job, id: 'layout-warrant', type: 'BUILDING_WARRANT' } : null} desktopMissingCount={10} />
</div></main></body></html>`);

const server = await dev({
  root: output, configFile: false, devToolbar: { enabled: false },
  server: { host: '127.0.0.1', port: 0 },
  integrations: [react(), tailwind({ configFile: path.resolve('tailwind.config.mjs'), applyBaseStyles: false })],
  vite: { resolve: { alias: { '@': path.join(root, 'src') } }, server: { fs: { allow: [root] } }, plugins: [{
    name: 'isolated-layout-api', configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/api/')) return next();
      res.setHeader('Content-Type', 'application/json');
      if (req.method !== 'GET') { res.statusCode = 503; res.end(JSON.stringify({ error: longError })); return; }
      // Status refreshes retain the selected fixture state rather than altering it.
      const state = new URL(req.headers.referer ?? 'http://fixture/').searchParams.get('state') ?? 'failed';
      res.end(JSON.stringify({ job: records[state] ?? baseJob, compatibleAgentOnline: true }));
    }); },
  }] },
});
const base = `http://127.0.0.1:${server.address.port}`;
console.log(`LAYOUT_FIXTURE_URL=${base}`);
if (process.argv.includes('--serve')) await new Promise(() => {});
else {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  const errors = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
  const geometry = () => page.evaluate(() => Object.fromEntries(['planning', 'building-warrant'].map(id => {
    const card = document.getElementById(id), rect = card.getBoundingClientRect();
    return [id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, fields: [...card.querySelectorAll('dl > div')].map(field => field.getBoundingClientRect().y - rect.y), footer: card.querySelector('footer').getBoundingClientRect().y - rect.y }];
  })));
  const open = async (query = '') => {
    await page.goto(base + query);
    await page.getByRole('heading', { name: 'Planning', exact: true }).waitFor();
    await page.locator('astro-island[ssr]').first().waitFor({ state: 'detached' });
  };
  try {
    for (const mirror of [false, true]) {
      await page.setViewportSize({ width: 1600, height: 1050 });
      await open(`?state=failed${mirror ? '&mirror=1' : ''}`);
      const neighbour = mirror ? 'planning' : 'building-warrant';
      const failed = mirror ? 'building-warrant' : 'planning';
      const before = await geometry();
      await page.getByText('Technical details', { exact: true }).click();
      const after = await geometry();
      check(`${failed}: expanding technical details grows only its own card (${before[failed].height} → ${after[failed].height}; neighbour ${before[neighbour].height} → ${after[neighbour].height})`, after[failed].height > before[failed].height && Math.abs(after[neighbour].height - before[neighbour].height) < 1);
      check(`${failed}: neighbour fields and footer do not move`, JSON.stringify(after[neighbour].fields) === JSON.stringify(before[neighbour].fields) && after[neighbour].footer === before[neighbour].footer);
      check(`${failed}: neighbour contains no stretched field rows`, Math.max(...after[neighbour].fields.map((top, index, fields) => index ? top - fields[index - 1] : 0)) < 90);
      await page.screenshot({ path: path.join(output, `desktop-${failed}-error.png`), fullPage: true });
    }
    for (const width of [1600, 1280, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await open('?state=failed&long=1');
      await page.getByText('Technical details', { exact: true }).click();
      await page.getByRole('button', { name: 'Complete Building Warrant details', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'unbroken-diagnostic-token' }).waitFor();
      check(`${width}px: long names and request errors cannot widen cards or the page`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('#planning, #building-warrant')].every(card => card.scrollWidth <= card.clientWidth + 1)));
      check(`${width}px: primary buttons remain inside their own card`, await page.evaluate(() => [...document.querySelectorAll('#planning .btn, #building-warrant .btn')].every(button => { const card = button.closest('#planning, #building-warrant').getBoundingClientRect(), rect = button.getBoundingClientRect(); return rect.left >= card.left && rect.right <= card.right; })));
      if (width === 390) await page.screenshot({ path: path.join(output, 'mobile-long-error.png'), fullPage: true });
    }
    let unchangedCard;
    const headings = { empty: 'Needs your attention', ready: 'Application prepared', active: 'Uploading supporting documents', review: 'Prepared — needs your review', submitted: 'Submitted — waiting for council' };
    for (const state of ['empty', 'ready', 'active', 'review', 'submitted']) {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await open(`?state=${state}`);
      check(`${state}: actual application state is rendered`, await page.locator('#planning').getByRole('heading', { name: headings[state], exact: true }).isVisible());
      const current = (await geometry())['building-warrant'];
      unchangedCard ??= current;
      check(`${state}: neighbour dimensions, fields and footer remain unchanged`, JSON.stringify(current) === JSON.stringify(unchangedCard));
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await open('?state=failed');
    await page.getByText('Technical details', { exact: true }).focus();
    await page.keyboard.press('Enter');
    check('Technical details remain keyboard operable', await page.locator('#planning details').evaluate(details => details.open));
    check('No browser runtime errors', errors.length === 0);
    console.log(JSON.stringify({ checks: checks.length, passed: checks, browserErrors: errors }, null, 2));
  } finally { await browser.close(); await server.stop(); }
}
