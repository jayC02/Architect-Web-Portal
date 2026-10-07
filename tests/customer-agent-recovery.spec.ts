import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import tailwindConfig from '../tailwind.config.mjs';

// Real React controls in a local, isolated browser fixture. Never import Prisma
// or connect to the configured application database. No portal automation.
let server: Server;
let base: string;
let connected = false;
let status = 'READY';
let statusUnavailable = false;
let mutations = 0;
const projection = () => ({ id: 'existing-ready', status, executionAuthorisedAt: '2026-09-01T10:00:00Z', progressStage: status === 'IN_PROGRESS' ? 'documents' : null, progressStageState: null, progressPercent: status === 'IN_PROGRESS' ? 42 : null, etaSeconds: null, progressMessage: null, resultSummary: null, error: null, resultData: null, lastCheckpoint: null, stale: false });
test.beforeAll(async () => {
  const js = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import Card from './src/components/automation/DesktopAutomationLiveCard';
    import Settings from './src/components/integrations/DesktopAccessIntegration';
    createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-4xl space-y-5 p-4"><h1 className="text-2xl font-semibold">Householder application</h1><div id="job" className="panel"><Card jobId="existing-ready" applicationId="planning" applicationStatus="DRAFTING" manageHref="/projects/test" detailsHref="/automation-job/existing-ready" initial={${JSON.stringify(projection())}} connectedAgent={false} applicationType="HOUSEHOLDER_PLANNING" recoveryContext={{projectId:'test'}} /></div><Settings /></main>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
  const css = await postcss([tailwindcss(tailwindConfig)]).process(readFileSync('src/styles/global.css', 'utf8'), { from: 'src/styles/global.css' });
  server = createServer((req, res) => {
    if (req.method !== 'GET') { mutations++; res.writeHead(405); res.end('{}'); return; }
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js.outputFiles[0].text); return; }
    if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); return; }
    if (req.url?.endsWith('/status')) {
      res.setHeader('Content-Type', 'application/json'); if (statusUnavailable) res.statusCode = 503;
      res.end(JSON.stringify({ job: projection(), compatibleAgentOnline: connected })); return;
    }
    if (req.url === '/api/settings/desktop-agents') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ agents: [{ id: 'same-registration', machineName: 'Practice PC', agentVersion: '4.1.0', connected, usable: connected, revokedAt: connected ? null : '2026-09-01T10:00:00Z', lastSeenAt: connected ? new Date().toISOString() : null, operatingState: connected ? 'READY' : 'DISCONNECTED' }] })); return;
    }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

test('queued/offline/reconnected states and reset confirmation remain customer-safe', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base);
  const job = page.locator('#job');
  await expect(job.getByRole('heading', { name: 'Agent disconnected' })).toBeVisible();
  await expect(job.getByRole('link', { name: 'Reconnect Agent' })).toHaveAttribute('href', '/settings/integrations#desktop-agent');
  await expect(job.getByRole('progressbar')).toHaveCount(0);
  await expect(job).not.toContainText('0%'); await expect(job).not.toContainText('Finishing up');
  await expect(page.getByText('Connected and ready', { exact: true })).toHaveCount(0);
  const reset = page.getByRole('button', { name: 'Reset connection', exact: true });
  await reset.focus(); await expect(reset).toBeFocused();
  const confirmation = page.waitForEvent('dialog');
  const press = page.keyboard.press('Enter');
  const dialog = await confirmation;
  expect(dialog.message()).toContain('It does not delete projects, applications or portal data.');
  await dialog.dismiss();
  await press;
  await expect(reset).toBeFocused();
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/customer-recovery-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  connected = true;
  await expect(job.getByRole('heading', { name: 'Waiting for Architect Pro Agent' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Connected and ready', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(job.getByRole('progressbar')).toHaveCount(0);
  connected = false;
  await expect(job.getByRole('heading', { name: 'Agent disconnected' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Connected and ready', { exact: true })).toHaveCount(0, { timeout: 10_000 });
  statusUnavailable = true;
  await expect(job.getByRole('heading', { name: 'Checking Agent connection' })).toBeVisible({ timeout: 10_000 });
  statusUnavailable = false; connected = true; status = 'IN_PROGRESS';
  await expect(job.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42', { timeout: 10_000 });
  await expect(job).toContainText('Uploading supporting documents');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: 'output/playwright/customer-recovery-desktop.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]); expect(mutations).toBe(0);
});
