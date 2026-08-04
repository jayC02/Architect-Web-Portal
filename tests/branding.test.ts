import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');
const brandLogo = read('src/components/brand/BrandLogo.astro');
const appShell = read('src/components/layout/AppShell.astro');
const authEntry = read('src/components/auth/AuthEntryScreen.astro');
const register = read('src/pages/register.astro');
const forgotPassword = read('src/pages/forgot-password.astro');
const resetPassword = read('src/pages/reset-password.astro');
const googleComplete = read('src/pages/auth/google/complete.astro');
const baseLayout = read('src/layouts/BaseLayout.astro');
const config = read('src/lib/config.ts');

for (const asset of [
  'public/brand/architect-pro-logo.png',
  'public/brand/architect-pro-mark.png',
  'public/brand/favicon.ico',
  'public/brand/favicon-16x16.png',
  'public/brand/favicon-32x32.png',
  'public/brand/apple-touch-icon.png',
]) {
  assert.equal(fs.existsSync(asset), true, `${asset} exists`);
  assert.ok(fs.statSync(asset).size > 0, `${asset} is not empty`);
}

assert.match(brandLogo, /variant\?: 'full' \| 'mark'/);
assert.match(brandLogo, /alt=\{decorative \? '' : 'Architect Pro'\}/);
assert.match(brandLogo, /width: 800, height: 280/);
assert.match(brandLogo, /width: 512, height: 512/);

assert.match(appShell, /<BrandLogo class="h-auto w-40 max-w-full" \/>/, 'desktop shell renders the full logo');
assert.match(appShell, /<BrandLogo variant="mark" class="h-8 w-8" \/>/, 'mobile shell renders the compact mark');
assert.match(appShell, /\{organisation\.name\}/, 'organisation name remains separately rendered');
assert.doesNotMatch(appShell, /Architect Web Portal|<Building2/, 'old shell placeholder branding is removed');

for (const surface of [authEntry, register, forgotPassword, resetPassword, googleComplete]) {
  assert.match(surface, /BrandLogo/, 'authentication surface uses the shared Architect Pro logo');
}

assert.match(baseLayout, /href="\/brand\/favicon\.ico"/);
assert.match(baseLayout, /href="\/brand\/favicon-32x32\.png"/);
assert.match(baseLayout, /href="\/brand\/apple-touch-icon\.png"/);
assert.match(baseLayout, /property="og:site_name" content=\{siteConfig\.name\}/);
assert.match(config, /name: 'Architect Pro'/);

console.log('Architect Pro branding regression tests passed');
