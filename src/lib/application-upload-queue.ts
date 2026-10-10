export type ApplicationUploadState =
  | 'Waiting'
  | 'Cancelled'
  | 'Uploading'
  | 'Retrying upload...'
  | 'Uploaded'
  | 'Finalising'
  | 'Waiting for analysis'
  | 'Could not upload'
  | 'Could not finalise';

export class UploadRequestError extends Error {
  constructor(message: string, readonly status?: number, readonly retryAfterMs?: number, readonly terminal = false) {
    super(message);
    this.name = 'UploadRequestError';
  }
}

export const isRetryableUploadError = (error: unknown) => {
  if (error instanceof UploadRequestError && error.terminal) return false;
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  if (error instanceof TypeError) return true;
  const status = error instanceof UploadRequestError ? error.status : undefined;
  if (status === undefined) return true;
  return status === 408 || status === 429 || (status >= 500 && status <= 599 && status !== 507);
};

export const retryTransientUpload = async <T>(
  attempt: () => Promise<T>,
  options: {
    delayMs?: number;
    onRetry?: () => void;
    attempts?: number;
    signal?: AbortSignal;
    onOffline?: () => void;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  } = {},
) => {
  const sleep = options.sleep ?? abortableDelay;
  for (let count = 0; count < (options.attempts ?? 5); count++) {
    await waitUntilOnline(options.signal, options.onOffline);
    options.signal?.throwIfAborted();
    try { return await attempt(); } catch (error) {
      if (!isRetryableUploadError(error) || count + 1 === (options.attempts ?? 5)) throw error;
      // A disconnected browser does not consume an automatic attempt.
      if (typeof window !== 'undefined' && navigator.onLine === false) { count--; continue; }
      options.onRetry?.();
      const backoff = Math.min(30_000, (options.delayMs ?? 750) * 2 ** count) * (0.8 + Math.random() * 0.4);
      await sleep(Math.max(backoff, error instanceof UploadRequestError ? error.retryAfterMs ?? 0 : 0), options.signal);
    }
  }
  throw new Error('Upload attempts exhausted.');
};

export const abortableDelay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal?.throwIfAborted();
  const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

export const waitUntilOnline = async (signal?: AbortSignal, onOffline?: () => void) => {
  if (typeof window === 'undefined' || navigator.onLine !== false) return;
  onOffline?.();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { window.removeEventListener('online', online); signal?.removeEventListener('abort', abort); };
    const online = () => { cleanup(); resolve(); };
    const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError')); };
    signal?.throwIfAborted();
    window.addEventListener('online', online, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
  });
};

export const createSingleFlight = <T>(create: () => Promise<T>) => {
  let hasValue = false;
  let value: T;
  let pending: Promise<T> | null = null;

  return async () => {
    if (hasValue) return value;
    if (!pending) {
      pending = create()
        .then((created) => {
          value = created;
          hasValue = true;
          return created;
        })
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  };
};

export const runUploadQueue = async <T>(
  items: readonly T[],
  concurrency: number,
  upload: (item: T) => Promise<void>,
) => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Upload concurrency must be at least one.');
  }

  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await upload(items[index]);
    }
  });
  await Promise.all(workers);
};

export const uploadPackageProgress = <T>(
  items: readonly T[],
  stateFor: (item: T) => ApplicationUploadState | undefined,
) => {
  const finalised = items.filter((item) => stateFor(item) === 'Waiting for analysis').length;
  const failed = items.filter((item) => {
    const state = stateFor(item);
    return state === 'Could not upload' || state === 'Could not finalise';
  }).length;
  return {
    total: items.length,
    finalised,
    failed,
    ready: items.length > 0 && finalised === items.length,
  };
};
