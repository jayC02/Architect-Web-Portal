// The silent test: the homepage story's key frames with its copy hidden.
// Each frame should still say what is happening: drawing it, making the application,
// calculating the wall, paying and running in the background, building it, checking it, time back.
// Run with the homepage preview: HOMEPAGE_PREVIEW_URL=http://127.0.0.1:4323 node scripts/homepage-silent-frames.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.HOMEPAGE_PREVIEW_URL || 'http://127.0.0.1:4323';
const output = path.resolve('output/homepage-preview/silent');
const FRAMES = [0.05, 0.1, 0.15, 0.19, 0.23, 0.31, 0.35, 0.41, 0.46, 0.55, 0.62, 0.71, 0.76, 0.84, 0.9, 0.99];
const SIZES = { desktop: { width: 1440, height: 900, mobile: false }, phone: { width: 390, height: 844, mobile: true } };

await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-proxy-server'] });
try {
  for (const [name, size] of Object.entries(SIZES)) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      screen: { width: size.width, height: size.height },
      isMobile: size.mobile, hasTouch: size.mobile, reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto(base);
    await page.locator('#loading.done').waitFor({ state: 'attached', timeout: 60000 });
    await page.addStyleTag({ content: '#copy, #ledger, .scroll-hint { visibility: hidden !important; }' });
    const shots = [];
    for (const at of FRAMES) {
      await page.evaluate(at => {
        const rail = document.querySelector('#rail');
        scrollTo({ top: rail.offsetTop + (rail.offsetHeight - innerHeight) * at, behavior: 'instant' });
      }, at);
      await page.waitForTimeout(1200);
      shots.push(await page.screenshot({ type: 'png' }));
      await fs.writeFile(path.join(output, `${name}-${String(at).replace('.', '_')}.png`), shots.at(-1));
    }
    // a 4 × 4 contact sheet, labelled with each frame's progress
    const sheet = await browser.newPage();
    const cell = name === 'desktop' ? { w: 480, h: 300 } : { w: 195, h: 422 };
    await sheet.setViewportSize({ width: cell.w * 4, height: cell.h * 4 });
    await sheet.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(4,${cell.w}px);font:600 14px system-ui">${shots
      .map((b, i) => `<figure style="margin:0;position:relative"><img style="width:${cell.w}px;height:${cell.h}px;display:block" src="data:image/png;base64,${b.toString('base64')}"><figcaption style="position:absolute;left:6px;bottom:6px;background:#fff;padding:2px 6px;border-radius:4px">${FRAMES[i]}</figcaption></figure>`)
      .join('')}</body>`);
    await sheet.screenshot({ path: path.join(output, `contact-sheet-${name}.png`) });
    await sheet.close();
    await context.close();
  }
  console.log(`Silent frames written to ${output}`);
} finally {
  await browser.close();
}
