export type ApplicationUploadState =
  | 'Waiting'
  | 'Uploading'
  | 'Uploaded'
  | 'Finalising'
  | 'Waiting for analysis'
  | 'Could not upload'
  | 'Could not finalise';

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
