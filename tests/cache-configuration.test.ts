import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const deployment = JSON.parse(read('vercel.json')) as {
  headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  redirects?: Array<{ source: string; destination: string }>;
};
const headerRules = deployment.headers ?? [];

const astroRules = headerRules.filter((rule) => rule.source.includes('_astro'));
assert.equal(astroRules.length, 0, 'Vercel config must not override caching for generated /_astro assets');
assert.equal(
  headerRules.some((rule) => rule.source.includes('_astro') && rule.headers.some((header) => (
    header.key.toLowerCase() === 'cache-control' && /immutable/i.test(header.value)
  ))),
  false,
  'missing /_astro assets must never inherit a wildcard immutable browser cache directive',
);

// Installers are no longer public static files: old links go to the gated route.
assert.equal(headerRules.some((rule) => rule.source.startsWith('/downloads')), false, 'installers must not be cacheable public assets');
assert.ok(
  deployment.redirects?.some((rule) => rule.source === '/downloads/:path*' && rule.destination === '/agent/download'),
  'old public download links redirect to the gated download route',
);
assert.equal(fs.existsSync(path.join(repositoryRoot, 'public/downloads')), false, 'no installers under public/');

const pageAuth = read('src/lib/server/page-auth.ts');
const cacheControl = read('src/lib/server/cache-control.ts');
assert.match(pageAuth, /setAstroCache\(Astro, privateNoStore\)/);
assert.match(cacheControl, /privateNoStore = 'private, no-store, max-age=0, must-revalidate'/);

for (const protectedPage of [
  'src/pages/dashboard.astro',
  'src/pages/projects/index.astro',
  'src/pages/projects/[id].astro',
  'src/pages/clients.astro',
  'src/pages/sites.astro',
  'src/pages/calendar.astro',
  'src/pages/finance.astro',
  'src/pages/settings.astro',
]) {
  const source = read(protectedPage);
  assert.match(source, /import \{ requirePageAuth \}/, `${protectedPage} imports the protected-page cache boundary`);
  assert.match(source, /await requirePageAuth\(Astro as never\)/, `${protectedPage} applies the protected-page cache boundary`);
}

const applicationFiles = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? applicationFiles(entryPath) : [entryPath];
  });
const serviceWorkerPattern = /(?:navigator\.)?serviceWorker|service-worker|serviceworker/i;
const serviceWorkerFiles = [path.join(repositoryRoot, 'src'), path.join(repositoryRoot, 'public')]
  .flatMap(applicationFiles)
  .filter((filePath) => serviceWorkerPattern.test(path.basename(filePath)));
assert.deepEqual(serviceWorkerFiles, [], 'the application does not ship a service worker');

console.log('cache configuration regression test passed');
