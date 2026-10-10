import { Upload, DetailedError } from 'tus-js-client';
import { retryTransientUpload, UploadRequestError } from './application-upload-queue';

export type TransferState = 'Waiting' | 'Uploading' | 'Verifying' | 'Uploaded' | 'Processing' | 'Ready' | 'Offline' | 'Retry scheduled' | 'Action required' | 'Failed' | 'Cancelled';
export type TransferProgress = { state: TransferState; bytes: number; total: number; documentId?: string; message?: string };
export type UploadIntent = {
  document: { id: string; uploadStatus: string };
  upload: { url: string; token: string; method?: 'put' | 'tus'; endpoint?: string; bucket?: string; objectName?: string } | null;
};
type Session = { hash: string; clientUploadId: string; intent?: UploadIntent; transferred: boolean };
const sessions = new WeakMap<File, Session>();
const retryAfter = (value: string | null) => value ? Math.max(0, /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now()) : undefined;

export async function uploadJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new UploadRequestError(response.status === 401 ? 'Sign in again to continue. Your completed uploads are safe.' : data.error || 'The request could not be completed.', response.status, retryAfter(response.headers.get('retry-after')), /not configured|unsupported.*provider|configuration.*required/i.test(data.error ?? ''));
  return data;
}

const put = (file: File, intent: UploadIntent, signal: AbortSignal, progress: (bytes: number) => void) => new Promise<void>((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  const abort = () => xhr.abort();
  signal.throwIfAborted();
  xhr.open('PUT', intent.upload!.url);
  xhr.timeout = 120_000;
  xhr.setRequestHeader('content-type', file.type || 'application/pdf');
  xhr.setRequestHeader('x-upsert', 'false');
  xhr.upload.onprogress = event => progress(event.loaded);
  const done = (error?: Error) => { signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) done();
    // A lost success response is resolved by authoritative finalisation, including the hash.
    else if (xhr.status === 409 || /already exists/i.test(xhr.responseText)) done();
    else done(new UploadRequestError('Storage transfer could not complete.', /token.*expir|expir.*token/i.test(xhr.responseText) ? 401 : xhr.status, retryAfter(xhr.getResponseHeader('retry-after'))));
  };
  xhr.onerror = () => done(new UploadRequestError('Connection interrupted.'));
  xhr.ontimeout = () => done(new UploadRequestError('Transfer timed out.', 408));
  xhr.onabort = () => done(new DOMException('Cancelled', 'AbortError'));
  signal.addEventListener('abort', abort, { once: true });
  xhr.send(file);
});

const tus = (file: File, intent: UploadIntent, hash: string, signal: AbortSignal, progress: (bytes: number) => void) => new Promise<void>((resolve, reject) => {
  const transfer = intent.upload!;
  const finish = (error?: Error) => { signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
  const abort = () => { void upload.abort(); finish(new DOMException('Cancelled', 'AbortError')); };
  signal.throwIfAborted();
  const upload = new Upload(file, {
    endpoint: transfer.endpoint, headers: { 'x-signature': transfer.token, 'x-upsert': 'false' },
    chunkSize: 6 * 1024 * 1024, retryDelays: null, uploadDataDuringCreation: true, removeFingerprintOnSuccess: true,
    fingerprint: async () => `architect-pro:${intent.document.id}:${hash}`,
    metadata: { bucketName: transfer.bucket!, objectName: transfer.objectName!, contentType: file.type || 'application/pdf', cacheControl: '3600' },
    onProgress: bytes => progress(bytes), onSuccess: () => finish(),
    onError: error => {
      const response = error instanceof DetailedError ? error.originalResponse : null;
      const status = response?.getStatus();
      if (status === 409 || /already exists/i.test(response?.getBody() ?? '')) finish();
      else finish(new UploadRequestError('Resumable transfer interrupted.', status, retryAfter(response?.getHeader('retry-after') ?? null)));
    },
    onBeforeRequest: request => { request.getUnderlyingObject().timeout = 120_000; },
  });
  signal.addEventListener('abort', abort, { once: true });
  void upload.findPreviousUploads().then(previous => {
    if (signal.aborted) return;
    if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
    upload.start();
  }).catch(error => finish(error));
});

/** Each stage has its own retry budget; successful transfer survives manual retry. */
export async function uploadDocument(file: File, baseUrl: string, options: {
  signal?: AbortSignal; onProgress?: (progress: TransferProgress) => void; metadata?: Record<string, unknown>;
} = {}) {
  const signal = options.signal ?? new AbortController().signal;
  let bytes = 0;
  const report = (state: TransferState, message?: string) => options.onProgress?.({ state, bytes, total: file.size, documentId: session?.intent?.document.id, message });
  let session = sessions.get(file);
  const stage = <T,>(run: () => Promise<T>) => retryTransientUpload(run, {
    signal, onRetry: () => report('Retry scheduled'), onOffline: () => report('Offline'),
  });
  try {
    if (!session) {
      report('Waiting', 'Checking file integrity');
      const buffer = await file.arrayBuffer();
      signal.throwIfAborted();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))).map(byte => byte.toString(16).padStart(2, '0')).join('');
      session = { hash, clientUploadId: crypto.randomUUID(), transferred: false };
      sessions.set(file, session);
    }
    const reserve = () => uploadJson<UploadIntent>(`${baseUrl}/upload-intent`, {
      filename: file.name, mimeType: file.type || 'application/pdf', size: file.size, clientSha256: session!.hash, clientUploadId: session!.clientUploadId, ...options.metadata,
    }, signal);
    session.intent ??= await stage(reserve);
    report(signal.aborted ? 'Cancelled' : 'Waiting');
    signal.throwIfAborted();
    if (session.intent.document.uploadStatus === 'READY') session.transferred = true;
    if (!session.transferred && session.intent.upload) {
      await stage(async () => {
        report('Uploading');
        try {
          const progress = (loaded: number) => { bytes = loaded; report('Uploading'); };
          await (session!.intent!.upload!.method === 'tus' ? tus(file, session!.intent!, session!.hash, signal, progress) : put(file, session!.intent!, signal, progress));
        } catch (error) {
          if (error instanceof UploadRequestError && (error.status === 401 || error.status === 403)) {
            // Only the storage token is refreshed here; a portal 401 remains action required.
            session!.intent = await reserve();
            throw new UploadRequestError('Upload credentials refreshed.', 408);
          }
          throw error;
        }
      });
      session.transferred = true;
    }
    bytes = file.size;
    report('Uploaded');
    await stage(async () => {
      report('Verifying');
      await uploadJson(`${baseUrl}/${session!.intent!.document.id}/finalise`, {}, signal);
    });
    signal.throwIfAborted();
    report('Ready');
    return session.intent.document.id;
  } catch (error) {
    report(signal.aborted ? 'Cancelled' : error instanceof UploadRequestError && (error.terminal || [400, 401, 403, 413, 507].includes(error.status ?? 0)) ? 'Action required' : 'Failed', error instanceof Error ? error.message : 'Upload failed.');
    throw error;
  }
}
