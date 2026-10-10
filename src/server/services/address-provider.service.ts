import { HttpError } from '@/lib/utils/http';
import { normalisePostcode } from '@/lib/addresses/uk-address';
import { routeScottishAuthorities } from '@/lib/addresses/authority-routing';

export type AddressCandidate = { id: string; label: string };
export type ResolvedAddress = { buildingNumber: string | null; addressLine1: string; addressLine2: string | null; townCity: string; postcode: string; country: string; uprn: string | null; addressProvider: string; addressVerifiedAt: string; addressProvenance: Record<string, unknown>; administrativeAuthority: string | null; planningAuthority: string | null; buildingStandardsAuthority: string | null; authorityVerification: 'suggested'; nationalPark: string | null };
type Options = { fetch?: typeof fetch; apiKey?: string; licensee?: string; licensed?: boolean };
const pending = new Map<string, Promise<unknown>>();
const cache = new Map<string, { expires: number; value: unknown }>();
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const configFor = (organisationId: string, options: Options) => {
  const apiKey = options.apiKey ?? process.env.IDEAL_POSTCODES_API_KEY;
  if (!apiKey) throw new HttpError(503, 'Address search is not configured. Enter the address manually.');
  const licensed = options.licensed ?? process.env.IDEAL_POSTCODES_PLATFORM_LICENSED === 'true';
  let mapping: Record<string, string> = {};
  try { mapping = JSON.parse(process.env.IDEAL_POSTCODES_LICENSEES ?? '{}'); } catch { /* Disabled unless explicitly configured. */ }
  const licensee = options.licensee ?? mapping[organisationId];
  if (!licensed || !licensee) throw new HttpError(503, 'Address search licensing is awaiting configuration. Manual entry is available.');
  return { apiKey, licensee };
};
async function shared<T>(key: string, run: () => Promise<T>, fresh = false): Promise<T> {
  const cached = !fresh && cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value as T;
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const request = run().then(value => { if (cache.size >= 200) cache.delete(cache.keys().next().value!); cache.set(key, { expires: Date.now() + 300_000, value }); return value; }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
async function ideal(organisationId: string, path: string, options: Options) {
  const { apiKey, licensee } = configFor(organisationId, options);
  const url = new URL(`https://api.ideal-postcodes.co.uk/v1/${path}`);
  url.searchParams.set('licensee', licensee);
  const response = await (options.fetch ?? fetch)(url, { headers: { Authorization: `api_key="${apiKey}"` }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new HttpError(503, 'Address provider is unavailable. Manual entry is available.');
  const payload = await response.json();
  if (payload.code !== 2000) throw new HttpError(503, 'Address provider could not resolve this address.');
  return payload.result;
}
export async function searchAddresses(organisationId: string, query: string, options: Options = {}): Promise<AddressCandidate[]> {
  if (query.trim().length < 3) return [];
  configFor(organisationId, options);
  return shared(`${organisationId}:search:${query.trim().toLowerCase()}`, async () => {
    const result = await ideal(organisationId, `autocomplete/addresses?q=${encodeURIComponent(query.trim())}&limit=10`, options);
    return (Array.isArray(result?.hits) ? result.hits : []).map((hit: Record<string, unknown>) => ({ id: text(hit.id), label: text(hit.suggestion) })).filter((hit: AddressCandidate) => hit.id && hit.label);
  }, Boolean(options.fetch));
}
export async function resolveAddress(organisationId: string, id: string, options: Options = {}): Promise<ResolvedAddress> {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new HttpError(400, 'Address identifier is invalid.');
  configFor(organisationId, options);
  return shared(`${organisationId}:resolve:${id}`, async () => {
    const result = await ideal(organisationId, `autocomplete/addresses/${encodeURIComponent(id)}/gbr`, options);
    const postcode = normalisePostcode(text(result.postcode));
    if (!postcode) throw new HttpError(503, 'The selected address has no valid postcode. Enter it manually.');
    let authorities = routeScottishAuthorities({});
    try {
      const response = await (options.fetch ?? fetch)(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) { const geography = (await response.json()).result; authorities = routeScottishAuthorities({ country: text(geography?.country), adminDistrict: text(geography?.admin_district), nationalPark: text(geography?.national_park), boundaryUncertain: Number(geography?.quality) > 1 }); }
    } catch { /* Address remains usable when geographic enrichment is unavailable. */ }
    const street = [text(result.dependant_thoroughfare), text(result.thoroughfare)].filter(Boolean).join(' ');
    const buildingNumber = text(result.building_number) || null;
    const subBuilding = [text(result.sub_building_name), text(result.building_name)].filter(Boolean).join(', ');
    // Named buildings and flat identifiers remain attached to the address.
    return { buildingNumber, addressLine1: [subBuilding, street].filter(Boolean).join(', ') || text(result.line_1), addressLine2: [text(result.double_dependant_locality), text(result.dependant_locality)].filter(Boolean).join(', ') || (street ? null : text(result.line_2) || null),
      townCity: text(result.post_town), postcode, country: 'United Kingdom', uprn: typeof result.udprn === 'undefined' && typeof result.uprn === 'undefined' ? null : result.uprn == null ? null : String(result.uprn),
      addressProvider: 'ideal-postcodes', addressVerifiedAt: new Date().toISOString(), addressProvenance: { provider: 'ideal-postcodes', addressId: id, catalogueVersion: authorities.catalogueVersion },
      administrativeAuthority: authorities.administrativeAuthority, planningAuthority: authorities.planningAuthority, buildingStandardsAuthority: authorities.buildingStandardsAuthority, authorityVerification: 'suggested', nationalPark: authorities.nationalPark };
  }, Boolean(options.fetch));
}
