export type ApplicationUploadState =
  | 'Waiting'
  | 'Uploading'
  | 'Retrying upload...'
  | 'Uploaded'
  | 'Finalising'
  | 'Waiting for analysis'
  | 'Could not upload'
  | 'Could not finalise';

export class UploadRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'UploadRequestError';
  }
}

export const applicationFileSha256 = async (file: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const isRetryableUploadError = (error: unknown) => {
  if (error instanceof Error && error.name === 'AbortError') return false;
  if (error instanceof TypeError) return true;
  const status = error instanceof UploadRequestError ? error.status : undefined;
  if (status === undefined) return true;
  return status === 408 || status === 429 || (status >= 500 && status <= 599 && status !== 507);
};

export const retryTransientUpload = async <T>(
  attempt: () => Promise<T>,
  options: {
    delayMs?: number;
    maxAttempts?: number;
    onRetry?: () => void;
  } = {},
) => {
  const maxAttempts = options.maxAttempts ?? 5;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('Upload attempts must be at least one.');
  for (let index = 0; ; index += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (index + 1 >= maxAttempts || !isRetryableUploadError(error)) throw error;
      options.onRetry?.();
      const delay = Math.min((options.delayMs ?? 750) * 2 ** index, 6000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
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
  const errors: unknown[] = [];
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        await upload(items[index]);
      } catch (error) {
        errors.push(error);
      }
    }
  });
  await Promise.all(workers);
  // Keep the caller busy until every worker stops, even when one upload fails.
  if (errors.length) throw errors[0];
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
