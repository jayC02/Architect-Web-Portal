import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.HOMEPAGE_PREVIEW_URL || 'http://127.0.0.1:4323';
const output = path.resolve('output/homepage-preview/scroll-story');
await fs.mkdir(output, { recursive: true });
// Local preview must bypass system proxies, including on managed Windows hosts.
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-proxy-server'] });
const checks = [], errors = [], failedAssets = [], apiCalls = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => { if (response.status() >= 400) failedAssets.push({ url: response.url(), status: response.status() }); });
page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url()); });
const ready = async () => {
  await page.locator('#loading.done').waitFor({ state: 'attached', timeout: 45000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#loading')).visibility === 'hidden');
};
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const scroll = async progress => {
  await page.evaluate(p => {
    const rail = document.querySelector('#rail');
    scrollTo(0, rail.offsetTop + (rail.offsetHeight - innerHeight) * p);
  }, progress);
  // Allow the original scrub and copy entrance to finish before inspecting geometry.
  await page.waitForTimeout(1700);
};
const shot = name => page.screenshot({ path: path.join(output, name) });
const boxes = () => page.evaluate(() => {
  const rect = selector => {
    const { top, bottom, left, right } = document.querySelector(selector).getBoundingClientRect();
    return { top, bottom, left, right };
  };
  return { copy: rect('#copy'), header: rect('.top'), dock: rect('.dock'), hud: document.querySelector('.hud.show:not(.dim)') ? rect('.hud') : null };
});

try {
  const response = await page.request.get(base, { maxRedirects: 0 });
  const html = await response.text();
  check('Signed-out root contains the complete server-rendered story', response.status() === 200 && html.includes('No more portal.') && html.includes('Then the design takes shape.') && html.includes('href="/register"'));
  check('Session-aware responses remain private', (response.headers()['cache-control'] || '').includes('private, no-store'));
  const signedIn = await page.request.get(base, { headers: { 'x-preview-signed-in': 'yes' }, maxRedirects: 0 });
  check('Signed-in visitors still reach the dashboard', signedIn.status() === 302 && signedIn.headers().location === '/dashboard');
  for (const query of ['reset=success', 'authError=google_failed', 'returnTo=%2Fprojects']) {
    const result = await page.request.get(`${base}/?${query}`, { maxRedirects: 0 });
    check(`Legacy ${query.split('=')[0]} entry still reaches sign in`, result.status() === 302 && result.headers().location.includes(query));
  }

  await page.goto(base); await ready();
  check('Homepage creates one 3D canvas and one main heading', await page.locator('canvas').count() === 1 && await page.locator('h1').count() === 1);
  check('Homepage retains the real brand and public SEO', await page.locator('.brand img').getAttribute('src') === '/brand/architect-pro-logo.png' && await page.locator('meta[name="robots"]').count() === 0);
  await page.getByRole('button', { name: 'Scroll to begin' }).click(); await page.waitForTimeout(2000);
  await shot('desktop-site.png');
  const names = ['Site', 'Design', 'The portal', 'Automation', 'Tracking', 'Time back'];
  for (let i = 0; i < names.length; i++) {
    const button = page.locator(`[data-jump="${i}"]`);
    await button.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(i => document.querySelector('#stage')?.dataset.act === String(i), i);
    check(`Keyboard chapter navigation reaches ${names[i]}`, await button.getAttribute('aria-current') === 'step');
  }
  await scroll(0.55); await shot('desktop-automation.png');
  check('Automation shows the project and background portal story', (await page.locator('#copy').innerText()).includes('background') && await page.locator('.hud').isVisible());
  await scroll(0.99); await shot('desktop-finale.png');
  check('Finale links directly to registration', await page.locator('#copy .primary').getAttribute('href') === '/register');
  check('Time comparison is explicitly illustrative', (await page.locator('#copy .note').innerText()).includes('illustrative') && await page.locator('.story-disclaimer').isVisible());
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#stage')?.dataset.act === '0');
  check('Replay returns to the first act', await page.locator('[data-jump="0"]').getAttribute('aria-current') === 'step');
  await scroll(0.72); await scroll(0.23);
  check('Scrolling backwards restores the earlier story', await page.locator('#stage').getAttribute('data-act') === '1');

  await page.setViewportSize({ width: 390, height: 844 }); await ready();
  for (const [i, progress] of [0.06, 0.23, 0.41, 0.55, 0.72, 0.88, 0.99].entries()) {
    await scroll(progress);
    check(`Phone story frame ${i + 1} has no overflow`, await noOverflow());
    const layout = await boxes();
    check(`Phone copy remains between header and chapter controls in frame ${i + 1}`, layout.copy.top >= layout.header.bottom && layout.copy.bottom <= layout.dock.top);
    if (layout.hud) check(`Phone status panel clears copy in frame ${i + 1}`, layout.hud.bottom <= layout.copy.top);
    if ([0, 3, 6].includes(i)) await shot(`mobile-${['site', '', '', 'automation', '', '', 'finale'][i]}.png`);
  }
  check('Compact chapter buttons retain descriptive names', await page.locator('[data-jump="3"]').getAttribute('aria-label') === '04 Automation');
  await page.setViewportSize({ width: 768, height: 1024 }); await ready();
  check('Tablet retains a usable 3D stage', await noOverflow() && await page.locator('canvas').count() === 1);
  await page.setViewportSize({ width: 1280, height: 800 }); await ready();
  check('Resizing preserves the current story act', await page.locator('#stage').getAttribute('data-act') === '5');

  await page.getByRole('button', { name: 'Simple view', exact: true }).click();
  check('Simple view removes the canvas and retains all acts', await page.locator('canvas').count() === 0 && await page.locator('.simple-acts > li').count() === 6);
  check('View switching retains keyboard focus', await page.getByRole('button', { name: 'Explore in 3D' }).evaluate(element => document.activeElement === element));
  for (const width of [320, 390, 600, 820, 1024, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    check(`Simple view fits ${width}px`, await noOverflow());
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, 'mobile-simple.png'), fullPage: true });
  await page.getByRole('button', { name: 'Explore in 3D' }).click();
  await page.getByRole('button', { name: 'Simple view', exact: true }).click();
  await page.getByRole('button', { name: 'Explore in 3D' }).click();
  await ready();
  check('Repeated switching leaves exactly one canvas', await page.locator('canvas').count() === 1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.simple').waitFor();
  check('A live reduced-motion change restores the ordinary page', await page.locator('canvas').count() === 0);
  await page.reload(); await page.getByRole('button', { name: 'Explore in 3D' }).waitFor();
  check('Reduced motion begins with the complete simple story', await page.locator('.simple-acts > li').count() === 6 && await page.locator('canvas').count() === 0);

  await page.getByRole('link', { name: 'Sign in', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Sign in to Architect Pro' }).waitFor();
  check('Sign in reaches the real form without homepage styling', await page.locator('form[data-action="/api/auth/login"]').count() === 1 && await page.locator('.scroll-home').count() === 0);
  await page.goto(base); await page.getByRole('link', { name: 'Create workspace', exact: true }).click();
  await page.getByRole('heading', { name: 'Create workspace' }).waitFor();
  check('Create workspace reaches real registration', await page.locator('form[data-action="/api/auth/register"]').count() === 1);
  for (const route of ['privacy', 'terms']) {
    await page.goto(base); await page.locator(`.site-footer a[href="/${route}"]`).click();
    check(`${route} link reaches its existing page`, new URL(page.url()).pathname === `/${route}` && await page.locator('h1').count() === 1);
  }

  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const staticPage = await noJs.newPage(); await staticPage.goto(base);
  check('No JavaScript still provides the full story and account links', await staticPage.locator('.simple-acts > li').count() === 6 && await staticPage.getByRole('link', { name: 'Create workspace', exact: true }).isVisible() && await staticPage.locator('[data-action="toggle-view"]').isHidden());
  await noJs.close();
  const reduced = await browser.newContext({ reducedMotion: 'reduce' });
  const reducedPage = await reduced.newPage(); const threeRequests = [];
  reducedPage.on('request', request => { if (/scene\/|three/.test(request.url())) threeRequests.push(request.url()); });
  await reducedPage.goto(base); await reducedPage.getByRole('button', { name: 'Explore in 3D' }).waitFor();
  check('Reduced motion does not request the 3D engine', threeRequests.length === 0);
  await reduced.close();

  const noGl = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await noGl.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.includes('webgl') ? null : getContext.call(this, type, ...args); };
  });
  const fallback = await noGl.newPage(); await fallback.goto(base);
  await fallback.locator('.simple-message').waitFor();
  check('Unavailable WebGL falls back to the readable story', await fallback.locator('.simple-acts > li').count() === 6 && (await fallback.locator('.simple-message').innerText()).includes('3D isn’t available'));
  await noGl.close();
  const failedModule = await browser.newContext();
  await failedModule.route('**/scroll-story/scene/index.js*', route => route.abort());
  const failedPage = await failedModule.newPage(); await failedPage.goto(base);
  await failedPage.locator('.simple-message').waitFor();
  check('A failed 3D download also restores the complete story', await failedPage.locator('.simple-acts > li').count() === 6);
  await failedModule.close();

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 844, height: 390 }); await page.goto(base);
  await page.getByRole('button', { name: 'Explore in 3D' }).waitFor();
  check('Short landscape screens start in readable Simple view', await page.locator('canvas').count() === 0 && await noOverflow());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base); await ready();
  await page.evaluate(() => {
    document.querySelector('canvas').dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  });
  await page.locator('.simple-message').waitFor();
  check('A lost WebGL context recovers to the simple story', (await page.locator('.simple-message').innerText()).includes('interrupted'));

  check('The story makes no API calls', apiCalls.length === 0);
  check('No unexpected failed assets', failedAssets.length === 0);
  check('No browser runtime errors', errors.length === 0);
  const result = { passed: checks.length, checks, browserErrors: errors, failedAssets, apiCalls, preview: base, data: 'Illustrative browser-only story. No database access or submissions.' };
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
