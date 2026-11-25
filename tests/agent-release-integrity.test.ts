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
assert.equal(offered.downloadUrl,'/agent/download');
assert.equal(manifest.storageKey,`ArchitectProAgentSetup-${manifest.version}.exe`);
assert.equal(manifest.sourceStorageKey,`ArchitectProAgentSource-${manifest.version}.zip`);

// Signed-out visitors are sent to sign in, never to the file.
const anonymous=await download({
  url:new URL('http://localhost/agent/download'),
  request:new Request('http://localhost/agent/download'),
  cookies:{get:()=>undefined,delete:()=>undefined},
  locals:{},
} as any);
assert.equal(anonymous.status,302);
assert.equal(anonymous.headers.get('Location'),'/login?returnTo=%2Fagent%2Fdownload');
assert.equal(anonymous.headers.get('Cache-Control'),'no-store');

// A bogus bearer token is rejected before any storage lookup.
const forged=await download({
  url:new URL('http://localhost/agent/download'),
  request:new Request('http://localhost/agent/download',{headers:{authorization:'Bearer nope'}}),
  cookies:{get:()=>undefined},
  locals:{},
} as any);
assert.equal(forged.status,401);

// The release bytes are kept outside public/ (never served statically).
assert.equal(existsSync('public/downloads'),false);
const file='agent-releases/'+manifest.storageKey;
assert.equal(statSync(file).size,manifest.sizeBytes);
assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),manifest.sha256);
assert.ok(statSync('agent-releases/'+manifest.sourceStorageKey).size>100000);
console.log(`Verified Agent ${manifest.version} installer hash, size and gated, uncached download route.`);
