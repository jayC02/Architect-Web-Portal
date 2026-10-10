export const prerender = false;
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireOrganisation } from '@/server/permissions/authz';
import { assertAllowedOrigin } from '@/lib/server/origin-guard';
import { assertRateLimit } from '@/lib/server/rate-limit';
import { withErrorHandling, parseBody } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { resolveAddress } from '@/server/services/address-provider.service';
import { assertDatabaseAllowance } from '@/server/services/upload-limits.service';
export const POST: APIRoute = context => withErrorHandling(async () => {
  assertAllowedOrigin(context.request);
  const { organisation, user } = await requireOrganisation(context);
  assertRateLimit(context, { name: 'address-resolution', max: 30, windowMs: 15 * 60_000 }, `${organisation.id}:${user.id}`);
  await assertDatabaseAllowance([[`address-user:${user.id}`, 30], [`address-org:${organisation.id}`, 100]], 15 * 60_000, 'Address resolution allowance reached. Enter the address manually or retry after the pause.');
  const input = await parseBody(context.request, z.object({ id: z.string().min(1).max(160) }).strict());
  return jsonResponse(200, { address: await resolveAddress(organisation.id, input.id) });
}, context);
