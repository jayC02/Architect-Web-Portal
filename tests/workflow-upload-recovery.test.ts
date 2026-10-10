import assert from 'node:assert/strict';
import { retryTransientUpload, runUploadQueue, UploadRequestError } from '../src/lib/application-upload-queue';
import { uploadDocument } from '../src/lib/document-upload-controller';
import { retryDatabaseTransaction } from '../src/server/services/transaction-retry';

let attempts = 0;
const delays: number[] = [];
assert.equal(await retryTransientUpload(async () => { if (++attempts < 5) throw new UploadRequestError('temporary', 503, 2000); return 'ok'; }, { sleep: async ms => { delays.push(ms); } }), 'ok');
assert.equal(attempts, 5);
assert.equal(delays.length, 4);
assert.ok(delays.every(ms => ms >= 2000));
attempts = 0;
await assert.rejects(retryTransientUpload(async () => { attempts++; throw new UploadRequestError('full', 507); }, { sleep: async () => {} }));
assert.equal(attempts, 1);
const controller = new AbortController(); controller.abort();
await assert.rejects(retryTransientUpload(async () => 'no', { signal: controller.signal }));
let conflicts = 0;
assert.equal(await retryDatabaseTransaction(async () => { if (++conflicts < 4) throw { code: 'P2034' }; return 'reserved'; }, async () => {}), 'reserved');
assert.equal(conflicts, 4);

// Offline pauses consume no attempts; cancellation interrupts retry timers.
const browserEvents = new EventTarget();
Object.defineProperty(globalThis, 'window', { value: browserEvents, configurable: true });
const connectivity = { onLine: false };
Object.defineProperty(globalThis, 'navigator', { value: connectivity, configurable: true });
let offlineAttempts = 0;
const paused = retryTransientUpload(async () => { offlineAttempts++; return 'resumed'; });
await Promise.resolve(); assert.equal(offlineAttempts, 0);
connectivity.onLine = true; browserEvents.dispatchEvent(new Event('online'));
assert.equal(await paused, 'resumed'); assert.equal(offlineAttempts, 1);
delete (globalThis as any).window;
const cancelRetry = new AbortController();
let cancelledAttempts = 0;
await assert.rejects(retryTransientUpload(async () => { cancelledAttempts++; throw new UploadRequestError('temporary', 503); }, { signal: cancelRetry.signal, onRetry: () => cancelRetry.abort() }));
assert.equal(cancelledAttempts, 1);

// A full package with lost finalisation responses sends each file only once.
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const originalFetch = globalThis.fetch;
const hashes = new Set<string>();
let transfers = 0;
let verification = 0;
const reserved = new Map<string, string>();
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith('upload-intent')) {
    const body = JSON.parse(String(init?.body));
    hashes.add(body.clientSha256);
    const id = reserved.get(body.clientSha256) ?? `doc-${reserved.size}`;
    reserved.set(body.clientSha256, id);
    return Response.json({ document: { id, uploadStatus: 'UPLOADING' }, upload: { url: 'https://storage.example.test/object', token: 'test' } });
  }
  verification++;
  if (verification === 1) return Response.json({ error: 'lost success response' }, { status: 503, headers: { 'Retry-After': '0' } });
  return Response.json({ ok: true });
};
class FakeXHR {
  upload: { onprogress?: (event: { loaded: number }) => void } = {};
  status = 200; responseText = ''; timeout = 0;
  onload?: () => void; onabort?: () => void;
  open() {} setRequestHeader() {} getResponseHeader() { return null; }
  send(file: File) { transfers++; this.upload.onprogress?.({ loaded: file.size }); queueMicrotask(() => this.onload?.()); }
  abort() { this.onabort?.(); }
}
Object.defineProperty(globalThis, 'XMLHttpRequest', { value: FakeXHR, configurable: true });
try {
  const files = Array.from({ length: 20 }, (_, index) => new File([`%PDF-1.4 test ${index}`], 'same-name.pdf', { type: 'application/pdf' }));
  await runUploadQueue(files, 3, async file => { await uploadDocument(file, '/documents'); });
  assert.equal(transfers, 20);
  assert.equal(reserved.size, 20, 'same filename and similar size cannot alias different contents');
  assert.equal(hashes.size, 20);
  assert.equal(verification, 21, 'verification retries without repeating transfer');
  await uploadDocument(files[0], '/documents');
  assert.equal(transfers, 20, 'manual retry reuses successful transfer');
  let tokenTransfers = 0, tokenReservations = 0;
  const packageFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url).endsWith('upload-intent')) tokenReservations++; return packageFetch(url, init); };
  class ExpiredTokenXHR extends FakeXHR {
    send(file: File) { this.status = ++tokenTransfers === 1 ? 403 : 200; this.responseText = this.status === 403 ? 'Storage token expired' : ''; super.send(file); }
  }
  Object.defineProperty(globalThis, 'XMLHttpRequest', { value: ExpiredTokenXHR, configurable: true });
  await uploadDocument(new File(['%PDF-1.4 expired token'], 'token.pdf', { type: 'application/pdf' }), '/documents');
  assert.equal(tokenTransfers, 2); assert.equal(tokenReservations, 2, 'expired storage token refreshes the same authenticated reservation');
  let portalAttempts = 0;
  globalThis.fetch = async () => { portalAttempts++; return Response.json({ error: 'Session expired' }, { status: 401 }); };
  await assert.rejects(uploadDocument(new File(['%PDF-1.4 portal'], 'portal.pdf', { type: 'application/pdf' }), '/documents'), /Sign in/);
  assert.equal(portalAttempts, 1, 'lost portal sessions require action rather than token-refresh loops');
} finally { globalThis.fetch = originalFetch; }
console.log('Workflow upload recovery passed: five attempts, hard stops, cancellation, transaction conflicts, full package, hashes and independent verification.');
