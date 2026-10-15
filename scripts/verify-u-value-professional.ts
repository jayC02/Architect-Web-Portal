import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import config from '../tailwind.config.mjs';
import UValueReport from '../src/components/tools/UValueReport';
import { saveUValueCalculation } from '../src/server/services/u-value.service';
import { reviewUValueCalculation } from '../src/server/services/u-value-review.service';
import { calculateUValue, uValueInputSchema } from '../src/lib/u-value/calculator';
import { draftInputs, restoredDraft } from '../src/lib/u-value/draft';
import { additionalMethods, type AdditionalMethod } from '../src/lib/u-value/methods';
import { methodExample } from '../tests/fixtures/u-value-methods';

mkdirSync('output/u-value', { recursive: true });
const js = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Calculator from './src/components/tools/UValueCalculator';import Review from './src/components/tools/UValueReview';import Template from './src/components/tools/UValueTemplateSave';(async()=>{const p=await(await fetch('/fixture/initial?path='+encodeURIComponent(location.pathname)+'&'+location.search.slice(1))).json();createRoot(document.getElementById('root')).render(p.review?<><Review {...p.review}/><Template id={p.review.id} title={p.title}/></>:<Calculator {...p}/>);})();`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const css = (await postcss([tailwindcss(config)]).process(readFileSync('src/styles/global.css', 'utf8'), { from: 'src/styles/global.css' })).css + readFileSync('src/styles/u-value-report.css', 'utf8');
const rows: any[] = [], events: any[] = [], templates: any[] = [];
const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]) => key === 'OR' ? (value as any[]).some(v => matches(row, v)) : row[key] === value);
const find = ({ where, orderBy }: any) => [...rows].sort((a, b) => orderBy?.revision ? b.revision - a.revision : 0).find(row => matches(row, where)) || null;
let tail = Promise.resolve(), loseReview = false;
const database: any = {
  uValueCalculation: { findUnique: async (args: any) => find(args), findFirst: async (args: any) => find(args),
    create: async ({ data }: any) => { const row = { ...structuredClone(data), id: `professional-${rows.length + 1}`, createdAt: new Date() }; rows.push(row); return row; },
    update: async ({ where, data }: any) => Object.assign(find({ where }), data) },
  uValueReviewEvent: { findUnique: async ({ where }: any) => events.find(e => matches(e, where)) || null, create: async ({ data }: any) => { const event = { ...data, createdAt: new Date(), id: `event-${events.length + 1}` }; events.push(event); return event; } },
  project: { findFirst: async () => ({ id: 'house', name: 'Example House', internalReference: 'EX01', siteAddress: 'Example project site' }) },
  $queryRaw: async () => [],
  $transaction: (fn: any) => { const result = tail.then(() => fn(database)); tail = result.then(() => {}, () => {}); return result; },
};
const scope = { organisationId: 'fixture', organisationName: 'Example Architectural Practice', userId: 'fixture-user', userName: 'Test Architect', database };
const report = (row: any) => renderToStaticMarkup(React.createElement(UValueReport, { ...row, createdAt: row.createdAt.toISOString(), input: row.inputSnapshot, result: row.resultSnapshot, context: row.contextSnapshot, events: events.filter(e => e.calculationId === row.id).map(e => ({ ...e, createdAt: e.createdAt.toISOString() })), superseded: rows.some(r => r.seriesId === row.seriesId && r.revision > row.revision) }));
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://127.0.0.1');
  const json = (data: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  try {
    if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(js.outputFiles[0].text); }
    if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
    if (url.pathname === '/fixture/lose-review') { loseReview = true; return json({ ok: true }); }
    if (url.pathname === '/fixture/initial') {
      const path = url.searchParams.get('path') || '/';
      if (path.startsWith('/tools/u-value/reports/')) { const row = rows.find(r => r.id === path.split('/').pop()); return json({ review: { id: row.id, status: row.status, inputHash: row.inputHash, revision: row.revision, latestId: [...rows].reverse().find(r => r.seriesId === row.seriesId)!.id }, title: row.title }); }
      const selected = rows.find(r => r.id === url.searchParams.get('calculationId'));
      const initial = selected ? restoredDraft(selected.inputSnapshot, { title: selected.title, projectId: selected.projectId, basedOnId: selected.id }) : methodExample((url.searchParams.get('method') || 'window') as AdditionalMethod);
      return json({ projects: [{ id: 'house', name: 'Example House', internalReference: 'EX01', siteAddress: 'Example project site' }], initial, templates: templates.map(t => ({ id: t.id, name: t.name })), storageKey: 'u-value-professional-fixture' });
    }
    if (url.pathname === '/api/u-value' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const calculation = await saveUValueCalculation({ ...scope, body: JSON.parse(body) });
      return json({ calculation, reportUrl: `/tools/u-value/reports/${calculation.id}` }, 201);
    }
    if (url.pathname.endsWith('/review') && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const event = await reviewUValueCalculation({ ...scope, calculationId: url.pathname.split('/').at(-2)!, body: JSON.parse(body) });
      if (loseReview) { loseReview = false; return json({ error: 'Temporary response failure. Retry the same review.' }, 503); }
      return json({ event });
    }
    if (url.pathname === '/api/u-value/templates' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const command = JSON.parse(body), row = rows.find(r => r.id === command.calculationId);
      const input = uValueInputSchema.parse(row.inputSnapshot); input.correctionsAssessed = false; input.target = null; input.targetReference = ''; if (input.methodData) input.methodData.applicabilityConfirmed = false;
      const template = { id: `template-${templates.length + 1}`, name: command.name, inputSnapshot: input }; templates.push(template); return json({ template }, 201);
    }
    if (url.pathname.startsWith('/api/u-value/templates/')) return json({ template: templates.find(t => t.id === url.pathname.split('/').pop()) });
    let body = '<main class="mx-auto max-w-7xl p-4 sm:p-8"><div id="root"></div></main><script src="/app.js"></script>';
    if (url.pathname.startsWith('/tools/u-value/reports/')) body = '<div class="mx-auto max-w-5xl p-6 report-controls"><a class="btn btn-secondary" href="/">Calculator</a></div><div id="root"></div>' + report(rows.find(r => r.id === url.pathname.split('/').pop())) + '<script src="/app.js"></script>';
    if (url.pathname === '/fixture/pack') body = `<article class="u-value-report report-pack-cover"><h1 class="text-3xl">Example House · U-value schedule</h1><p>Current issued calculation reports</p></article>` + rows.filter(r => r.status === 'ISSUED' && !rows.some(newer => newer.seriesId === r.seriesId && newer.revision > r.revision)).map(report).join('');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Professional calculator verification</title></head><body>${body}</body></html>`);
  } catch (problem: any) { json({ error: problem.message }, problem.status || 400); }
});
await new Promise<void>(resolve => server.listen(4335, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const failures: string[] = []; page.on('pageerror', error => failures.push(error.message));
const base = 'http://127.0.0.1:4335';
const text = async (locator: any, expected: string) => { await locator.waitFor(); assert.equal(await locator.textContent(), expected); };
try {
  for (const method of Object.keys(additionalMethods) as AdditionalMethod[]) {
    await page.goto(`${base}/?method=${method}`);
    await text(page.getByLabel('U-value', { exact: true }), calculateUValue(draftInputs(methodExample(method))).displayUValue);
    assert.equal(await page.getByRole('button', { name: 'Create calculation report' }).isEnabled(), true);
    await page.getByLabel('I have checked the method conditions above', { exact: false }).uncheck();
    await page.getByRole('status').filter({ hasText: 'Confirm that this construction' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Create calculation report' }).isEnabled(), false);
    await page.getByLabel('I have checked the method conditions above', { exact: false }).check();
    if (method === 'heated_basement' || method === 'tapered_roof') {
      await page.getByRole('button', { name: 'Create calculation report' }).click(); await page.waitForURL('**/tools/u-value/reports/**');
      await page.pdf({ path: `output/u-value/professional-${method}.pdf`, format: 'A4', preferCSSPageSize: true, printBackground: true });
    }
  }
  await page.goto(`${base}/?method=window`);
  await page.getByLabel('Total projected opening area (m²)', { exact: true }).fill('3');
  await page.getByRole('status').filter({ hasText: 'sum to total opening' }).waitFor();
  await page.getByLabel('Total projected opening area (m²)', { exact: true }).fill('2');
  await page.getByRole('combobox', { name: /Project · optional/ }).selectOption('house');
  await page.screenshot({ path: 'output/u-value/professional-window-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'output/u-value/professional-window-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile has no horizontal page overflow');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Create calculation report' }).click(); await page.waitForURL('**/tools/u-value/reports/**');
  const first = rows.at(-1); assert.equal(first.status, 'DRAFT');
  await page.getByLabel('Review statement', { exact: true }).fill('Reviewed component areas, values, edge contributions and evidence.');
  const complete = page.getByRole('button', { name: 'Mark review complete' }); assert.equal(await complete.isEnabled(), false);
  for (const checkbox of await page.locator('#root input[type=checkbox]').all()) await checkbox.check();
  await page.request.get(`${base}/fixture/lose-review`); await complete.click();
  await page.getByRole('alert').filter({ hasText: 'Temporary response failure' }).waitFor();
  const count = events.length; await complete.click(); await page.getByLabel('Purpose of issue', { exact: true }).waitFor(); assert.equal(events.length, count, 'lost review response retries once');
  await page.getByLabel('Purpose of issue', { exact: true }).fill('Issued for the example building warrant package.');
  await page.getByRole('button', { name: 'Issue calculation report', exact: true }).click(); await page.getByLabel('Withdrawal reason', { exact: true }).waitFor();
  assert.equal(first.status, 'ISSUED');
  await page.screenshot({ path: 'output/u-value/professional-issued-report.png', fullPage: true });
  await page.pdf({ path: 'output/u-value/professional-issued-window.pdf', format: 'A4', preferCSSPageSize: true, printBackground: true });
  await page.getByRole('button', { name: 'Save construction template' }).click(); await page.getByRole('status').filter({ hasText: 'Construction template saved' }).waitFor();
  await page.goto(`${base}/?calculationId=${first.id}`); await page.getByLabel('Total projected opening area (m²)', { exact: true }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: /Project · optional/ }).isDisabled(), true);
  await page.getByLabel('Calculation name', { exact: true }).fill('Window revision 2');
  await page.getByRole('button', { name: 'Create calculation report' }).click(); await page.waitForURL('**/tools/u-value/reports/**');
  const revised = rows.at(-1); assert.equal(revised.revision, 2);
  await page.goto(`${base}/tools/u-value/reports/${first.id}`); await page.getByText('A newer revision exists.').waitFor(); assert.equal(await page.getByRole('button', { name: 'Mark review complete' }).count(), 0);
  await page.getByLabel('Withdrawal reason', { exact: true }).fill('Superseded component specification is withdrawn.'); await page.getByRole('button', { name: 'Withdraw report', exact: true }).click();
  await page.getByText('WITHDRAWN · do not rely on this report', { exact: true }).waitFor(); assert.equal(first.status, 'WITHDRAWN');
  await page.goto(`${base}/?method=window`); await page.getByRole('combobox', { name: /Construction templates/ }).selectOption(templates[0].id);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Use construction template' }).click();
  await page.getByRole('status').filter({ hasText: 'Construction template loaded' }).waitFor(); assert.equal(await page.getByRole('combobox', { name: /Project · optional/ }).inputValue(), ''); assert.equal(await page.getByRole('button', { name: 'Create calculation report' }).isEnabled(), false);
  await reviewUValueCalculation({ ...scope, calculationId: revised.id, body: { requestId: crypto.randomUUID(), action: 'review', inputHash: revised.inputHash, statement: 'Checked revised window inputs and applicability.', checks: { geometry: true, designValues: true, corrections: true, scope: true } } });
  await reviewUValueCalculation({ ...scope, calculationId: revised.id, body: { requestId: crypto.randomUUID(), action: 'issue', inputHash: revised.inputHash, statement: 'Issued revised window for the example package.' } });
  await page.goto(`${base}/fixture/pack`); await page.pdf({ path: 'output/u-value/professional-project-pack.pdf', format: 'A4', preferCSSPageSize: true, printBackground: true });
  assert.equal(await page.locator('.report-status').count(), 1, 'pack excludes superseded/withdrawn/unissued reports');
  assert.deepEqual(failures, []);
  writeFileSync('output/u-value/professional-browser-results.json', JSON.stringify({ methods: Object.keys(additionalMethods), browserErrors: failures, reports: rows.length, reviewEvents: events.length, templates: templates.length, verified: ['live method forms', 'scope gate', 'opening area rejection', 'mobile', 'save report', 'review loss/retry', 'issue', 'revision', 'stale report', 'withdraw', 'template reassessment', 'project pack PDF'] }, null, 2));
  console.log('PASS professional method forms, review/retry/issue/revision/withdrawal, templates, mobile and project pack PDFs.');
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
