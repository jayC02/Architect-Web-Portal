import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.HOMEPAGE_PREVIEW_URL || 'http://127.0.0.1:4323';
const output = path.resolve('output/homepage-preview/scroll-story');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-proxy-server'] });
const checks = [], errors = [], failedAssets = [], apiCalls = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failedAssets.push({ url: response.url(), status: response.status() }); });
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url()); });
};
const ready = async page => {
  await page.locator('#loading.done').waitFor({ state: 'attached', timeout: 45000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#loading')).visibility === 'hidden');
};
const progress = page => page.evaluate(() => {
  const rail = document.querySelector('#rail');
  return (scrollY - rail.offsetTop) / (rail.offsetHeight - innerHeight);
});
const scroll = async (page, p, wait = 350) => {
  await page.evaluate(p => {
    const rail = document.querySelector('#rail');
    scrollTo({ top: rail.offsetTop + (rail.offsetHeight - innerHeight) * p, behavior: 'instant' });
  }, p);
  await page.waitForTimeout(wait);
};
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const shot = (page, name) => page.screenshot({ path: path.join(output, name) });
const phoneSettings = { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce' };

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); watch(page);
  const response = await page.request.get(base, { maxRedirects: 0 });
  const html = await response.text();
  check('Server renders the rail before graphics or scroll restoration', response.status() === 200 && html.includes('id="rail"') && html.includes('Then the design takes shape.'));
  check('The view switch is absent from server HTML', !html.includes('Simple view') && !html.includes('toggle-view'));
  check('Session-aware responses remain private', (response.headers()['cache-control'] || '').includes('private, no-store'));
  const signedIn = await page.request.get(base, { headers: { 'x-preview-signed-in': 'yes' }, maxRedirects: 0 });
  check('Signed-in visitors still reach the dashboard', signedIn.status() === 302 && signedIn.headers().location === '/dashboard');
  for (const query of ['reset=success', 'authError=google_failed', 'returnTo=%2Fprojects']) {
    const result = await page.request.get(`${base}/?${query}`, { maxRedirects: 0 });
    check(`Legacy ${query.split('=')[0]} links still reach sign in`, result.status() === 302 && result.headers().location.includes(query));
  }
  await page.goto(base); await ready(page);
  check('Desktop opens in 3D with one canvas and one heading', await page.locator('canvas').count() === 1 && await page.locator('h1').count() === 1);
  check('Existing logo and account routes remain present', await page.locator('.brand img').getAttribute('src') === '/brand/architect-pro-logo.png' && await page.locator('.account-create').getAttribute('href') === '/register');
  await page.getByRole('button', { name: 'Scroll to begin' }).click(); await page.waitForTimeout(1800);
  await shot(page, 'desktop-site.png');
  for (let i = 0; i < 6; i++) {
    const button = page.locator(`[data-jump="${i}"]`);
    await button.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(i => document.querySelector('#stage').dataset.act === String(i), i);
    check(`Keyboard navigation reaches chapter ${i + 1}`, await button.getAttribute('aria-current') === 'step');
  }
  await scroll(page, 0.99, 1800); await shot(page, 'desktop-finale.png');
  check('Finale links to registration and labels the illustration', await page.locator('#copy .primary').getAttribute('href') === '/register' && (await page.locator('#copy .note').innerText()).includes('illustrative'));
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  await page.waitForFunction(() => scrollY < 10);
  check('Replay is the deliberate action that returns to the start', await page.locator('#stage').getAttribute('data-act') === '0');
  await page.close();

  const mobileContext = await browser.newContext(phoneSettings);
  await mobileContext.addInitScript(() => {
    window.__qaTextureCanvases = [];
    const create = document.createElement.bind(document);
    document.createElement = (name, ...args) => {
      const element = create(name, ...args);
      if (name.toLowerCase() === 'canvas') window.__qaTextureCanvases.push(element);
      return element;
    };
  });
  const phone = await mobileContext.newPage(); watch(phone);
  await phone.goto(base); await ready(phone);
  check('An emulated iPhone with Reduce Motion opens in 3D', await phone.locator('canvas').count() === 1 && await phone.locator('[data-action="toggle-view"]').count() === 0);
  check('Mobile rendering is capped at 1.5x pixel density', await phone.locator('canvas').evaluate(canvas => canvas.width / canvas.clientWidth <= 1.501));
  await scroll(phone, 0.41);
  check('Uploaded document canvases release their backing memory', await phone.evaluate(() => window.__qaTextureCanvases.filter(canvas => canvas.width === 1 && canvas.height === 1).length >= 24));
  await scroll(phone, 0.55); const beforeReload = await progress(phone);
  await phone.reload(); await ready(phone);
  check('Reload restores the same story position', Math.abs(await progress(phone) - beforeReload) < 0.002 && await phone.locator('#stage').getAttribute('data-act') === '3');
  await scroll(phone, 0.35);
  check('Scrolling up after reload moves backwards without restarting', Math.abs(await progress(phone) - 0.35) < 0.002 && await phone.locator('#stage').getAttribute('data-act') === '2');
  await scroll(phone, 0.55);
  const canvas = await phone.locator('canvas').elementHandle();
  const copy = await phone.locator('#copy').elementHandle();
  const beforeToolbar = await phone.evaluate(() => scrollY);
  await phone.setViewportSize({ width: 390, height: 780 }); await phone.waitForTimeout(300);
  check('Toolbar-height changes keep the scene and scroll position', await canvas.evaluate(el => el === document.querySelector('canvas')) && Math.abs(await phone.evaluate(() => scrollY) - beforeToolbar) < 2);
  await phone.setViewportSize({ width: 390, height: 844 }); await phone.waitForTimeout(300);
  await phone.setViewportSize({ width: 844, height: 390 }); await phone.waitForTimeout(400);
  check('Rotation preserves progress without rebuilding the canvas', Math.abs(await progress(phone) - 0.55) < 0.002 && await canvas.evaluate(el => el === document.querySelector('canvas')));
  await shot(phone, 'mobile-landscape.png');
  await phone.setViewportSize({ width: 390, height: 844 }); await phone.waitForTimeout(400);
  check('Rotating back retains the same position', Math.abs(await progress(phone) - 0.55) < 0.002);
  await phone.evaluate(() => {
    window.__qaLostCanvas = document.querySelector('canvas');
    window.__qaLostCanvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext();
  });
  await phone.waitForFunction(() => document.querySelector('canvas') && document.querySelector('canvas') !== window.__qaLostCanvas && document.querySelector('#loading.done'));
  await ready(phone);
  check('A real WebGL reset rebuilds only the graphics', !await canvas.evaluate(el => el.isConnected) && await copy.evaluate(el => el === document.querySelector('#copy')) && await phone.locator('canvas').count() === 1);
  check('Graphics recovery keeps the same story position', Math.abs(await progress(phone) - 0.55) < 0.002 && await phone.locator('#stage').getAttribute('data-act') === '3');
  await phone.emulateMedia({ reducedMotion: 'no-preference' });
  check('Changing motion preference does not replace the scene', await phone.locator('canvas').count() === 1 && Math.abs(await progress(phone) - 0.55) < 0.002);
  await phone.emulateMedia({ reducedMotion: 'reduce' });
  check('Pull-to-refresh is disabled on the homepage', await phone.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY === 'none'));

  for (const [width, height] of [[320,568],[375,667],[390,844],[768,1024],[568,320],[667,375],[844,390],[932,430]]) {
    await phone.setViewportSize({ width, height }); await phone.waitForTimeout(350);
    for (const p of [0.06,0.23,0.41,0.55,0.72,0.88,0.99]) {
      await scroll(phone, p);
      const geometry = await phone.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect();
        const copy = box('#copy'), header = box('.top'), dock = box('.dock');
        const hud = document.querySelector('.hud.show:not(.dim)') ? box('.hud') : null;
        const overlap = hud && copy.left < hud.right && copy.right > hud.left && copy.top < hud.bottom && copy.bottom > hud.top;
        return { copyFits: copy.top >= header.bottom - 1 && copy.bottom <= dock.top + 1, overlap };
      });
      check(`${width}×${height} chapter frame ${p} stays usable in 3D`, await noOverflow(phone) && geometry.copyFits && !geometry.overlap && await phone.locator('canvas').count() === 1);
    }
    if (width === 390) await shot(phone, 'mobile-finale.png');
  }
  await phone.setViewportSize({ width: 390, height: 844 }); await phone.waitForTimeout(400);
  await scroll(phone, 0.55); await shot(phone, 'mobile-automation.png');
  await phone.getByRole('link', { name: 'Sign in', exact: true }).first().click();
  await phone.getByRole('heading', { name: 'Sign in to Architect Pro' }).waitFor();
  check('Sign in reaches the real form with normal page scrolling', await phone.locator('form[data-action="/api/auth/login"]').count() === 1 && await phone.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY !== 'none'));
  await phone.goBack(); await ready(phone);
  check('Returning from sign in retains the story position', Math.abs(await progress(phone) - 0.55) < 0.002);
  await phone.getByRole('link', { name: 'Create workspace', exact: true }).click();
  await phone.getByRole('heading', { name: 'Create workspace' }).waitFor();
  check('Create workspace still reaches real registration', await phone.locator('form[data-action="/api/auth/register"]').count() === 1);
  for (const route of ['privacy', 'terms']) {
    await phone.goto(base); await ready(phone); await phone.locator(`.site-footer a[href="/${route}"]`).click();
    check(`${route} remains reachable`, new URL(phone.url()).pathname === `/${route}`);
  }
  await mobileContext.close();

  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const staticPage = await noJs.newPage(); await staticPage.goto(base);
  check('No JavaScript retains all story text and real account links', await staticPage.locator('.story-transcript section').count() === 6 && await staticPage.locator('.account-create').isVisible() && await staticPage.locator('#rail').isHidden());
  await noJs.close();
  const noGl = await browser.newContext(phoneSettings);
  await noGl.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.includes('webgl') ? null : original.call(this,type,...args); };
  });
  const unsupported = await noGl.newPage(); watch(unsupported); await unsupported.goto(base);
  await unsupported.locator('#loading.failed').waitFor();
  await scroll(unsupported, 0.55);
  check('Unavailable WebGL explains the failure while text still scrolls', (await unsupported.locator('#loading-text').innerText()).includes('Scroll to read') && await unsupported.locator('#stage').getAttribute('data-act') === '3' && await unsupported.locator('.simple').count() === 0);
  await noGl.close();
  const missing = await browser.newContext(phoneSettings);
  await missing.route('**/scroll-story/scene/index.js*', route => route.abort());
  const download = await missing.newPage(); await download.goto(base); await download.locator('#loading.failed').waitFor();
  await scroll(download, 0.72);
  check('A failed engine download leaves the chapter story usable', await download.locator('#stage').getAttribute('data-act') === '4' && await download.locator('.account-create').isVisible());
  await missing.close();
  const storage = await browser.newContext(phoneSettings);
  await storage.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) { if (key === 'architectpro-story-progress') throw new Error('Storage unavailable'); return get.call(this,key); };
    Storage.prototype.setItem = function(key,value) { if (key === 'architectpro-story-progress') throw new Error('Storage unavailable'); return set.call(this,key,value); };
  });
  const privatePage = await storage.newPage(); watch(privatePage); await privatePage.goto(base); await ready(privatePage); await scroll(privatePage, 0.55);
  check('Unavailable session storage does not break 3D scrolling', await privatePage.locator('#stage').getAttribute('data-act') === '3');
  await storage.close();

  check('The homepage makes no application API calls', apiCalls.length === 0);
  check('No unexpected failed assets', failedAssets.length === 0);
  check('No browser runtime errors', errors.length === 0);
  const result = { passed: checks.length, checks, errors, failedAssets, apiCalls, preview: base, device: 'Emulated phone in Chrome, not a physical iPhone.' };
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally { await browser.close(); }
