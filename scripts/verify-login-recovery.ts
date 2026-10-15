import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { chromium } from 'playwright';
import config from '../tailwind.config.mjs';

// Real customer-facing React card and API client; isolated fixture responses.
// Domain/transaction behaviour is executed in login-failure-recovery.test.ts.
const js = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Card from './src/components/automation/DesktopAutomationLiveCard';(async()=>{const p=await(await fetch('/fixture/initial'+location.search)).json();createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-4xl p-4"><h1 className="mb-5 text-2xl font-semibold">Building Warrant application</h1><div className="panel rounded-xl"><Card {...p}/></div></main>);})();`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const css = (await postcss([tailwindcss(config)]).process(readFileSync('src/styles/global.css', 'utf8'), { from: 'src/styles/global.css' })).css;
const legacy = { outcome: 'failed_final', failureCategory: 'AUTOMATION_FAILED', errorCode: 'AUTOMATION_FAILED', currentSection: 'login', lastCompletedStep: null, retrySafe: false, safeRetryPoint: null, recoveryAction: 'close' };
const projection = (status: string, resultData: unknown = legacy) => ({ id: 'failed-login', status, executionAuthorisedAt: '2026-10-15T12:00:00Z', progressStage: 'login', progressStageState: 'failed', progressPercent: 7, etaSeconds: null, progressMessage: null, resultSummary: 'Automation stopped before sign-in completed.', error: 'Sign-in did not complete.', resultData, lastCheckpoint: 'login', stale: false });
let mutations = 0, failRestart = true;
const statusRequests: string[] = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://127.0.0.1');
  const json = (value: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(js.outputFiles[0].text); }
  if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (url.pathname === '/fixture/initial') {
    const mode = url.searchParams.get('case');
    const initial = mode === 'modern' ? projection('FAILED_RETRYABLE', { ...legacy, outcome: 'failed_retryable', failureCategory: 'AUTHENTICATION_FAILED', errorCode: 'AUTHENTICATION_FAILED', retrySafe: true, safeRetryPoint: 'login', recoveryAction: 'update_login' }) : projection('FAILED_FINAL');
    if (mode === 'unsafe') { initial.progressStage = initial.lastCheckpoint = 'documents'; initial.resultData = { ...legacy, currentSection: 'documents' }; }
    return json({ jobId: 'failed-login', applicationId: 'warrant', applicationStatus: 'DRAFTING', manageHref: '/projects/example', detailsHref: '/automation-job/failed-login', initial, connectedAgent: true, applicationType: 'BUILDING_WARRANT', recoveryContext: { client: null, site: null, applicationId: 'warrant', documentsHref: '/projects/example#documents', portalHref: null, typeOfWorkKeys: [], typeOfWorkOptions: [], agentDefaults: null, organisationName: 'Example Practice', canManageAgentDefaults: false } });
  }
  if (url.pathname.endsWith('/restart') && req.method === 'POST') {
    mutations++; assert.equal(url.pathname, '/api/automation-jobs/failed-login/restart');
    await new Promise(resolve => setTimeout(resolve, 150));
    if (failRestart) { failRestart = false; return json({ error: 'Temporary connection failure. Try restarting again.' }, 503); }
    return json({ job: { ...projection('READY', null), id: 'fresh-login-attempt', progressStage: null, progressStageState: null, lastCheckpoint: null, error: null, progressPercent: null, executionAuthorisedAt: new Date().toISOString() }, compatibleAgentOnline: true }, 201);
  }
  if (url.pathname.endsWith('/status')) { statusRequests.push(url.pathname); return json({ job: { ...projection('READY', null), id: 'fresh-login-attempt', progressStage: null, progressStageState: null, error: null }, compatibleAgentOnline: true }); }
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Login recovery verification</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
mkdirSync('output/login-recovery', { recursive: true });
try {
  await page.goto(base);
  await page.getByRole('heading', { name: 'Sign-in did not complete' }).waitFor();
  const restart = page.getByRole('button', { name: 'Restart after updating login', exact: true }); await restart.waitFor();
  assert.equal(await page.getByRole('link', { name: 'Update Agent login' }).getAttribute('href'), 'architectpro://settings/login');
  await page.screenshot({ path: 'output/login-recovery/desktop.png', fullPage: true });
  await restart.focus(); await page.keyboard.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'Temporary connection failure' }).waitFor();
  assert.equal(await restart.isEnabled(), true);
  await restart.click(); await page.getByText('Waiting for Architect Pro Agent', { exact: true }).waitFor();
  assert.equal(mutations, 2); assert.ok(statusRequests.some(path => path.includes('fresh-login-attempt')));
  assert.equal(await restart.count(), 0, 'successful restart leaves the failed card');
  await page.goto(`${base}/?case=modern`); await restart.waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const box = await restart.boundingBox(); assert.ok(box && box.width > 180 && box.height >= 36, 'restart is a full-size button');
  await page.screenshot({ path: 'output/login-recovery/mobile.png', fullPage: true });
  await page.goto(`${base}/?case=unsafe`); await page.getByText('Automation stopped', { exact: true }).waitFor();
  assert.equal(await restart.count(), 0, 'a later unknown failure has no blind restart');
  assert.deepEqual(errors, []);
  console.log('PASS legacy/current login recovery, visible controls, restart error/retry, fresh-job polling, keyboard, mobile and later-state exclusion; no browser errors.');
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
