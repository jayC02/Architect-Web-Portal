import { AsyncLocalStorage } from 'node:async_hooks';

type PerfMetric = { label: string; duration: number };
type PerfStore = { start: number; metrics: PerfMetric[] };

const perfStore = new AsyncLocalStorage<PerfStore>();

export const shouldLogPerf = () => {
  const flag = process.env.DEBUG_PERF;
  return flag === '1' || flag === 'true';
};

const metricName = (label: string) => label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);

export async function withPerf<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const duration = performance.now() - start;
    perfStore.getStore()?.metrics.push({ label: metricName(label), duration });
    if (shouldLogPerf()) {
      const ms = duration.toFixed(1);
      console.info(`[perf] ${label}: ${ms}ms`);
    }
  }
}

export async function withServerTiming(fn: () => Promise<Response>): Promise<Response> {
  if (!shouldLogPerf()) return fn();

  return perfStore.run({ start: performance.now(), metrics: [] }, async () => {
    const response = await fn();
    const store = perfStore.getStore();
    if (!store) return response;

    const total = performance.now() - store.start;
    const metrics = [...store.metrics, { label: 'total', duration: total }];
    response.headers.set(
      'Server-Timing',
      metrics.map((metric) => `${metric.label};dur=${metric.duration.toFixed(1)}`).join(', '),
    );
    return response;
  });
}
