import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import UValueReport from '../src/components/tools/UValueReport';
import { calculateUValue, uValueInputSchema } from '../src/lib/u-value/calculator';
import { saveUValueCalculation } from '../src/server/services/u-value.service';
import config from '../tailwind.config.mjs';

mkdirSync('output/u-value', { recursive: true });
const js = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Calculator from './src/components/tools/UValueCalculator';(async()=>{const props=await(await fetch('/fixture/initial')).json();createRoot(document.getElementById('root')).render(<Calculator {...props}/>);})();`,
  resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
const css = await postcss([tailwindcss(config)]).process(readFileSync('src/styles/global.css', 'utf8'), { from: 'src/styles/global.css' });
const reportCss = readFileSync('src/styles/u-value-report.css', 'utf8');
const seedInput = uValueInputSchema.parse({ element: 'wall', correctionsAssessed: true, layers: [
  { id: 'lining', kind: 'solid', name: 'Gyproc WallBoard 12.5 mm', thicknessMm: 12.5, lambda: 0.19, source: 'British Gypsum product data sheet, 17 October 2025; λ 0.19 W/mK. https://www.british-gypsum.com/download-documents/product-data-sheet-pds/british-gypsum-pds-gyproc-wallboard-12-5mm.pdf' },
  { id: 'insulation', kind: 'solid', name: '100 mm insulation between timber studs', thicknessMm: 100, lambda: 0.038, source: 'Referenced insulation declaration.', bridge: { name: 'Timber studs', lambda: 0.13, fraction: 0.15, group: 'studs', source: 'Timber design value and framing area from drawing W01.' } },
  { id: 'air', kind: 'air', name: 'Unventilated cavity', thicknessMm: 50, resistance: 0.18, ventilation: 'unventilated', source: 'Assessed cavity resistance for horizontal heat flow and high emissivity.' },
  { id: 'brick', kind: 'solid', name: 'Facing brick', thicknessMm: 102.5, lambda: 0.77, source: 'Referenced masonry design value.' },
], target: 0.3, targetReference: 'Project-specific example target; confirm applicable handbook clause.' });
const legacyInput: any = structuredClone(seedInput), legacyResult: any = calculateUValue(seedInput);
delete legacyInput.automaticCorrections;
for (const layer of legacyInput.layers) for (const key of ['airMode', 'widthMm', 'heightMm', 'emissivity1', 'emissivity2', 'emissivityEvidence']) delete layer[key];
delete legacyResult.engineVersion; delete legacyResult.correctionDetails; legacyResult.methodVersion = 'AP-THERMAL-1.0.0';
const rows: any[] = [{ id: 'saved-example-0000000001', title: 'External wall · W01', projectId: 'project', createdAt: new Date('2026-10-14T10:00:00Z'), inputHash: 'a'.repeat(64), inputSnapshot: legacyInput,
  resultSnapshot: legacyResult, contextSnapshot: { organisationName: 'Example Architectural Practice', preparedBy: 'Test Architect', projectName: 'Oak House', reference: 'W01', location: 'Example site, Glasgow' } }];
const find = ({ where }: any) => rows.find(row => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
const database: any = { uValueCalculation: { findUnique: async (args: any) => find(args), create: async ({ data }: any) => {
  const row = { ...structuredClone(data), id: `fixture-calculation-${String(rows.length + 1).padStart(10, '0')}`, createdAt: new Date() }; rows.push(row); return row;
} }, project: { findFirst: async () => ({ id: 'project', name: 'Oak House', internalReference: 'W01', siteAddress: 'Example site, Glasgow' }) }, $transaction: async (fn: any) => fn(database) };
let loseNextSave = false, delayLoad = false;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, 'http://127.0.0.1');
    const json = (data: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    if (url.pathname === '/fixture/initial') return json({ projects: [{ id: 'project', name: 'Oak House', internalReference: 'W01', siteAddress: 'Example site, Glasgow' }], storageKey: 'u-value-fixture', initialSaved: rows.map(({ id, title, projectId, createdAt }) => ({ id, title, projectId, createdAt })) });
    if (url.pathname === '/fixture/lose-save') { loseNextSave = true; return json({ ok: true }); }
    if (url.pathname === '/fixture/delay-load') { delayLoad = true; return json({ ok: true }); }
    if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(js.outputFiles[0].text); }
    if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css.css + reportCss); }
    if (url.pathname === '/api/u-value' && req.method === 'POST') {
      let payload = ''; for await (const chunk of req) payload += chunk;
      const calculation = await saveUValueCalculation({ organisationId: 'fixture', organisationName: 'Example Architectural Practice', userId: 'fixture-user', userName: 'Test Architect', body: JSON.parse(payload), database });
      if (loseNextSave) { loseNextSave = false; return json({ error: 'Temporary connection failure. Please try again.' }, 503); }
      return json({ calculation, reportUrl: `/tools/u-value/reports/${calculation.id}` }, 201);
    }
    if (url.pathname.startsWith('/api/u-value/')) {
      if (delayLoad) { delayLoad = false; await new Promise(resolve => setTimeout(resolve, 1000)); }
      const calculation = rows.find(row => row.id === url.pathname.split('/').pop()); return json({ calculation }, calculation ? 200 : 404);
    }
    let body = '<main class="mx-auto max-w-7xl p-4 sm:p-8"><div id="root"></div></main><script src="/app.js"></script>';
    if (url.pathname.startsWith('/tools/u-value/reports/')) {
      const row = rows.find(row => row.id === url.pathname.split('/').pop()); assert.ok(row);
      body = `<div class="report-controls mx-auto flex max-w-5xl justify-between p-6"><a class="btn btn-secondary" href="/">Back to calculator</a><button class="btn btn-primary" onclick="window.print()">Print / save PDF</button></div>` + renderToStaticMarkup(React.createElement(UValueReport, { ...row, createdAt: row.createdAt.toISOString(), input: row.inputSnapshot, result: row.resultSnapshot, context: row.contextSnapshot }));
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>U-value verification fixture</title><link rel="stylesheet" href="/style.css"></head><body>${body}</body></html>`);
  } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
});
await new Promise<void>(resolve => server.listen(4334, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const failures: string[] = []; page.on('pageerror', error => failures.push(error.message));
const base = 'http://127.0.0.1:4334';
const expectText = async (locator: any, expected: string) => { await locator.waitFor(); assert.equal(await locator.textContent(), expected); };
try {
  await page.goto(base);
  await page.getByRole('button', { name: 'Add first layer' }).click();
  await page.getByLabel('Calculation name', { exact: true }).fill('PIR external wall');
  await page.getByLabel('Project · optional').selectOption('project');
  await page.getByLabel('Material library for layer 1').selectOption('sopratherm-ga4000');
  await expectText(page.getByLabel('U-value', { exact: true }), '0.21');
  assert.equal(await page.getByLabel('Design conductivity λ (W/mK)', { exact: true }).isEditable(), false);
  await page.getByLabel('Thickness (mm)', { exact: true }).fill('125');
  await page.getByRole('status').filter({ hasText: 'not listed at 125 mm' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Create calculation report' }).isEnabled(), false);
  await page.getByLabel('Thickness (mm)', { exact: true }).fill('100');
  await page.getByLabel('I have assessed applicable corrections', { exact: false }).check();
  await page.screenshot({ path: 'output/u-value/calculator-desktop.png', fullPage: true });
  await page.request.get(`${base}/fixture/lose-save`);
  await page.getByRole('button', { name: 'Create calculation report' }).click();
  await page.getByRole('alert').filter({ hasText: 'Temporary connection failure' }).waitFor();
  assert.equal(await page.getByLabel('Calculation name', { exact: true }).inputValue(), 'PIR external wall');
  assert.equal(rows.length, 2);
  await page.getByRole('button', { name: 'Create calculation report' }).click();
  await page.waitForURL('**/tools/u-value/reports/**'); assert.equal(rows.length, 2, 'a lost response followed by retry saves one report');
  assert.equal(rows[1].contextSnapshot.projectName, 'Oak House');
  const displayed = await page.locator('.report-result > div > strong').textContent();
  assert.match(displayed!, /0\.21\s*W\/m²K/);
  await page.goto(`${base}/tools/u-value/reports/${rows[0].id}`);
  await page.screenshot({ path: 'output/u-value/report-desktop.png', fullPage: true });
  await page.pdf({ path: 'output/u-value/report-example.pdf', format: 'A4', preferCSSPageSize: true, printBackground: true });
  await page.goto(base);
  await page.getByRole('combobox', { name: /Saved calculations/ }).selectOption(rows[0].id);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Load copy' }).click();
  await page.getByRole('status').filter({ hasText: 'Loaded a working copy' }).waitFor();
  assert.equal(await page.locator('[data-layer]').count(), 4);
  await page.getByLabel('Calculation name', { exact: true }).fill('Edited working copy');
  await page.locator('[data-layer]').nth(1).getByLabel('Thickness (mm)', { exact: true }).fill('120');
  await page.getByRole('button', { name: 'Create calculation report' }).click();
  await page.waitForURL('**/tools/u-value/reports/**');
  assert.equal(rows[0].inputSnapshot.layers[1].thicknessMm, 100); assert.equal(rows.length, 3);
  await page.goto(base); await page.getByLabel('Calculation name', { exact: true }).fill('Keep my newer edits');
  await page.getByRole('combobox', { name: /Saved calculations/ }).selectOption(rows[0].id);
  await page.request.get(`${base}/fixture/delay-load`); page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Load copy' }).click();
  await page.getByLabel('Calculation name', { exact: true }).fill('Typed while loading');
  await page.getByRole('status').filter({ hasText: 'Your newer edits have been kept' }).waitFor();
  assert.equal(await page.getByLabel('Calculation name', { exact: true }).inputValue(), 'Typed while loading');
  await page.getByLabel('Construction system').selectOption('steel-frame');
  await page.getByRole('status').filter({ hasText: 'This construction needs a specialist' }).waitFor();
  await page.getByLabel('Construction system').selectOption('standard');
  await page.getByLabel('Building element').selectOption('ground-slab');
  await page.getByLabel('Floor area A (m²)').fill('100'); await page.getByLabel('Exposed perimeter P (m)').fill('40');
  await page.getByLabel('Floor configuration').selectOption('suspended');
  await page.getByRole('status').filter({ hasText: 'specialist ISO 13370' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'output/u-value/calculator-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile page has no horizontal overflow');
  await page.goto(`${base}/tools/u-value/reports/${rows[0].id}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile report has no horizontal overflow');
  await page.screenshot({ path: 'output/u-value/report-mobile.png', fullPage: true });
  await page.goto(base);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('u-value-corruption-tested')) {
      localStorage.setItem('u-value-fixture', JSON.stringify({ version: 1, draft: { title: 'Corrupted draft', layers: [{}] } }));
      sessionStorage.setItem('u-value-corruption-tested', 'true');
    }
  });
  await page.reload(); await page.getByRole('button', { name: 'Add first layer' }).waitFor();
  assert.equal(await page.getByLabel('Calculation name', { exact: true }).inputValue(), '');
  await page.getByLabel('Calculation name', { exact: true }).focus(); await page.keyboard.press('Tab');
  assert.equal(await page.getByLabel('Project · optional').evaluate((element: HTMLElement) => element === document.activeElement), true);
  await page.getByRole('button', { name: 'Add first layer' }).click();
  await page.getByLabel('Calculation name', { exact: true }).fill('Wall with calculated corrections');
  await page.getByLabel('Material library for layer 1').selectOption('rockwool-flexi');
  await page.getByText('U-value corrections', { exact: true }).click();
  await page.getByRole('button', { name: 'Add air-gap correction' }).click();
  const airgap = page.getByRole('region', { name: 'Calculated correction 1' });
  await airgap.getByLabel('Correction basis / product reference').fill('Installation design: level 1 air gaps, no air circulation.');
  await page.getByRole('button', { name: 'Add fixing correction' }).click();
  const fixing = page.getByRole('region', { name: 'Calculated correction 2' });
  await fixing.getByLabel('Fixing conductivity λf (W/mK)').fill('50');
  await fixing.getByLabel('Metal fixing diameter (mm)').fill('4');
  await fixing.getByLabel('Number of fixings per m²').fill('4');
  await fixing.getByLabel('These are perpendicular', { exact: false }).check();
  await fixing.getByLabel('Correction basis / product reference').fill('Fixing product declaration and fixing layout; perpendicular steel core.');
  await page.getByRole('button', { name: 'Add air cavity' }).click();
  const air = page.locator('[data-layer]').nth(1);
  await air.getByLabel('Layer name').fill('Reflective cavity');
  await air.getByLabel('Cavity resistance method').selectOption('table');
  await air.getByLabel('Cavity width (mm)').fill('2000');
  await air.getByLabel('Cavity height / length (mm)').fill('2500');
  await page.waitForFunction(() => document.querySelector('output')?.textContent !== '—');
  await air.getByLabel('Cavity resistance method').selectOption('emissivity');
  await air.getByLabel('Second surface emissivity').fill('0.08');
  await air.getByLabel('Emissivity certification / evidence').fill('ANIT mathematical reference case; example data only.');
  await page.waitForFunction(() => document.querySelector('output')?.textContent !== '—');
  await fixing.getByRole('combobox', { name: /Metal penetration/ }).selectOption('recessed');
  await fixing.getByLabel('Metal penetration depth (mm)').fill('50');
  await air.getByLabel('Cavity ventilation').selectOption('well');
  await page.getByRole('status').filter({ hasText: 'Reflective ventilated cavities require' }).waitFor();
  await air.getByLabel('Cavity ventilation').selectOption('unventilated');
  await page.getByLabel('I have assessed applicable corrections', { exact: false }).check();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'output/u-value/calculator-integrated-desktop.png', fullPage: true });
  assert.equal(await page.getByRole('button', { name: 'Create calculation report' }).isEnabled(), true);
  await page.getByRole('button', { name: 'Create calculation report' }).click();
  await page.waitForURL('**/tools/u-value/reports/**');
  assert.equal(rows.length, 4); assert.equal(rows[3].resultSnapshot.correctionDetails.length, 2);
  assert.equal(rows[3].resultSnapshot.engineVersion, '4.0.0');
  assert.ok(rows[3].resultSnapshot.correction > 0);
  assert.equal(rows[3].inputSnapshot.layers[1].emissivity2, 0.08);
  await page.getByText('Af = π', { exact: false }).waitFor();
  await page.screenshot({ path: 'output/u-value/report-integrated-desktop.png', fullPage: true });
  await page.pdf({ path: 'output/u-value/report-integrated.pdf', format: 'A4', preferCSSPageSize: true, printBackground: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'calculated report has no mobile overflow');
  await page.screenshot({ path: 'output/u-value/report-integrated-mobile.png', fullPage: true });
  await page.goto(base); await page.getByLabel('Calculation name', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-layer]').count(), 2, 'new calculation drafts restore their layers');
  await page.getByText('U-value corrections', { exact: true }).click();
  assert.equal(await page.getByRole('region', { name: /Calculated correction/ }).count(), 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'correction controls have no mobile overflow');
  await page.screenshot({ path: 'output/u-value/calculator-integrated-mobile.png', fullPage: true });
  assert.deepEqual(failures, []);
  writeFileSync('output/u-value/browser-results.json', JSON.stringify({ passed: true, savedReports: rows.length, browserErrors: failures, flows: ['manufacturer material and thickness validation', 'save response lost and idempotent retry', 'project metadata', 'immutable report copy', 'edits during loading', 'specialist scope', 'mobile calculator and report', 'corrupt local draft recovery', 'keyboard order', 'A4 PDF generation'] }, null, 2));
  console.log('PASS browser flows, save recovery, immutable copy, scope validation, keyboard, mobile layout and PDF generation.');
} catch (error) {
  await page.screenshot({ path: 'output/u-value/browser-failure.png', fullPage: true });
  console.error('Browser state:', await page.locator('[role="status"], [role="alert"]').allTextContents(), failures);
  throw error;
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
