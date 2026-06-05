export const shouldLogPerf = () => {
  const flag = process.env.DEBUG_PERF;
  return flag === '1' || flag === 'true';
};

export async function withPerf<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    if (shouldLogPerf()) {
      const ms = (performance.now() - start).toFixed(1);
      console.info(`[perf] ${label}: ${ms}ms`);
    }
  }
}
