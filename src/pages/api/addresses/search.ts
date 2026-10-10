export const prerender = false;
import type { APIRoute } from 'astro';
import { requireOrganisation } from '@/server/permissions/authz';
import { assertRateLimit } from '@/lib/server/rate-limit';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { searchAddresses } from '@/server/services/address-provider.service';
export const GET: APIRoute = context => withErrorHandling(async () => {
  const { organisation, user } = await requireOrganisation(context);
  assertRateLimit(context, { name: 'address-search', max: 180, windowMs: 60_000 }, `${organisation.id}:${user.id}`);
  return jsonResponse(200, { candidates: await searchAddresses(organisation.id, (context.url.searchParams.get('q') ?? '').slice(0, 200)) });
}, context);
