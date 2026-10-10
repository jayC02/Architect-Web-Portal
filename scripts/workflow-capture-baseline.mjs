import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
const fixture = JSON.parse(await fs.readFile('output/workflow/extended-fixtures.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4332', reducedMotion: 'reduce' });
const login = await context.request.post('/api/auth/login', { headers: { Origin: 'http://127.0.0.1:4332' }, data: { email: fixture.email, password: 'SyntheticFixture123!' } });
if (!login.ok()) throw new Error(`Baseline login failed (${login.status()}).`);
const page = await context.newPage();
const statuses = [];
await fs.mkdir('output/workflow/baseline-screenshots', { recursive: true });
for (const width of [1440,1366,1024,390]) {
  await page.setViewportSize({ width, height: 900 });
  for (const [name, url] of [['projects','/projects'], ['overview',`/projects/${fixture.projectId}`], ['prepared-review',`/applications/${fixture.baselineDraftId}`], ['upload',`/documents/upload?projectId=${fixture.projectId}`], ['finance',`/projects/${fixture.historicalProjectId}#fees`]]) {
    const response = await page.goto(url); statuses.push({ name, width, status: response.status() });
    if (!response.ok()) throw new Error(`Baseline ${name} failed (${response.status()}).`);
    await page.locator('main').waitFor();
    await page.screenshot({ path: `output/workflow/baseline-screenshots/${name}-${width}.png`, fullPage: true });
  }
}
await fs.writeFile('output/workflow/baseline-screenshots/results.json', JSON.stringify({ sourceCommit: 'bd75264', retrospective: true, statuses }, null, 2));
await browser.close();
console.log('Retrospective original-commit screenshots captured at four widths against synthetic isolated fixtures.');
