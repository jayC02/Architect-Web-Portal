import { HttpError } from '@/lib/utils/http';

export async function retryDatabaseTransaction<T>(run: () => Promise<T>, delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await run(); } catch (error) {
      const code = (error as { code?: string })?.code;
      if (!['P2034', 'P2002', '40001', '40P01'].includes(code ?? '')) throw error;
      if (attempt === 4) throw new HttpError(503, 'Another upload is reserving space. Please retry.', { retryAfterSeconds: 2 });
      await delay(Math.min(500, 25 * 2 ** attempt) + Math.random() * 25);
    }
  }
  throw new HttpError(503, 'Upload reservation unavailable.');
}
