import type { APIContext } from 'astro';
import { databaseTable } from '@/lib/db/table';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';
import { assertRateLimit } from '@/lib/server/rate-limit';

/** Shared database counters also cover simultaneous Vercel instances. */
export async function assertAuthenticatedUploadLimit(context: APIContext, organisationId: string, userId: string) {
  assertRateLimit(context, { name: 'upload-abuse', windowMs: 60_000, max: 600 });
  await assertDatabaseAllowance([[`user:${userId}`, 1200], [`organisation:${organisationId}`, 6000]], 15 * 60_000, 'Upload allowance reached. Your files are safe; retry after the pause.');
}
export async function assertDatabaseAllowance(limits: Array<readonly [string, number]>, windowMs: number, message: string) {
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  for (const [key, max] of limits) {
    const [counter] = await prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO ${databaseTable('UploadRateLimit')} AS counter ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT ("key") DO UPDATE SET "count" = CASE WHEN counter."windowStart" = EXCLUDED."windowStart" THEN counter."count" + 1 ELSE 1 END,
      "windowStart" = EXCLUDED."windowStart" RETURNING "count"`;
    if (counter.count > max) throw new HttpError(429, message, {
      retryAfterSeconds: Math.ceil((windowStart.getTime() + windowMs - Date.now()) / 1000),
    });
  }
}
