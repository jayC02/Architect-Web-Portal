import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {GET as download} from '../src/pages/agent/download';
import {GET as release} from '../src/pages/api/desktop/releases/latest';

const manifest=JSON.parse(readFileSync('src/config/agent-release.json','utf8'));
const metadata=await release({} as any);
const offered=await metadata.json();
assert.equal(metadata.headers.get('Cache-Control'),'no-store');
assert.equal(offered.version,manifest.version);
assert.equal(offered.downloadUrl,manifest.downloadUrl);
assert.equal(offered.sourceDownloadUrl,manifest.sourceDownloadUrl);
const redirect=await download({} as any);
assert.equal(redirect.status,302);
assert.equal(redirect.headers.get('Location'),manifest.downloadUrl);
assert.equal(redirect.headers.get('Cache-Control'),'no-store');
const file='public'+manifest.downloadUrl;
assert.equal(statSync(file).size,manifest.sizeBytes);
assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),manifest.sha256);
const sourceFile='public'+manifest.sourceDownloadUrl;
assert.ok(statSync(sourceFile).size>100000);
assert.equal(createHash('sha256').update(readFileSync(sourceFile)).digest('hex'),manifest.sourceSha256);
console.log(`Verified Agent ${manifest.version} installer hash, size, source download and uncached update routes.`);


// A rollback must pair an older installer with that version's source and integrity metadata.
const releaseKeys = ['AGENT_RELEASE_VERSION', 'AGENT_RELEASE_DOWNLOAD_URL', 'AGENT_RELEASE_SHA256', 'AGENT_RELEASE_SIZE_BYTES', 'AGENT_RELEASE_STATUS'] as const;
const before = Object.fromEntries(releaseKeys.map(key => [key, process.env[key]]));
try {
  for (const key of releaseKeys) delete process.env[key];
  process.env.AGENT_RELEASE_VERSION = '4.2.27';
  const partial = await (await release({} as any)).json();
  assert.equal(partial.status, 'BUILDING');
  assert.equal((await download({} as any)).status, 503);

  const previousInstaller = '/downloads/ArchitectProAgentSetup-4.2.27.exe';
  const previousSource = '/downloads/ArchitectProAgentSource-4.2.27.zip';
  process.env.AGENT_RELEASE_SHA256 = createHash('sha256').update(readFileSync('public'+previousInstaller)).digest('hex');
  process.env.AGENT_RELEASE_SIZE_BYTES = String(statSync('public'+previousInstaller).size);
  const previous = await (await release({} as any)).json();
  assert.equal(previous.status, 'AVAILABLE');
  assert.equal(previous.downloadUrl, previousInstaller);
  assert.equal(previous.sourceDownloadUrl, previousSource);
  assert.ok(statSync('public'+previousSource).size>100000);
  assert.equal((await download({} as any)).headers.get('Location'), previousInstaller);

  process.env.AGENT_RELEASE_SIZE_BYTES = 'not-a-size';
  const malformed = await (await release({} as any)).json();
  assert.equal(malformed.sizeBytes, 0);
  assert.equal(malformed.status, 'BUILDING');
  process.env.AGENT_RELEASE_SIZE_BYTES = String(statSync('public'+previousInstaller).size);

  process.env.AGENT_RELEASE_DOWNLOAD_URL = manifest.downloadUrl;
  assert.equal((await (await release({} as any)).json()).status, 'BUILDING');
  assert.equal((await download({} as any)).status, 503);

  const installerOnly = '/downloads/ArchitectProAgentSetup-4.1.0.exe';
  process.env.AGENT_RELEASE_VERSION = '4.1.0';
  process.env.AGENT_RELEASE_DOWNLOAD_URL = installerOnly;
  process.env.AGENT_RELEASE_SHA256 = createHash('sha256').update(readFileSync('public'+installerOnly)).digest('hex');
  process.env.AGENT_RELEASE_SIZE_BYTES = String(statSync('public'+installerOnly).size);
  const legacy = await (await release({} as any)).json();
  assert.equal(legacy.status, 'AVAILABLE');
  assert.equal(legacy.sourceDownloadUrl, null);
  assert.equal(existsSync('public/downloads/ArchitectProAgentSource-4.1.0.zip'), false);
  assert.equal((await download({} as any)).headers.get('Location'), installerOnly);
} finally {
  for (const key of releaseKeys) {
    if (before[key] === undefined) delete process.env[key];
    else process.env[key] = before[key];
  }
}
console.log('Verified matched rollback metadata and withheld incomplete or mismatched release offers.');
