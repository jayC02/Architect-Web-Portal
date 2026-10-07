import { createHash } from 'node:crypto';
import { addressIdentity, normalisePostcode, normaliseUkAddress, type AddressParts } from '@/lib/addresses/uk-address';

export type SiteLookupInput = AddressParts & { country?: string | null; localAuthority?: string | null };
export type SiteLookupResult = {
  status: 'verified' | 'ambiguous' | 'not_found' | 'unavailable' | 'not_configured' | 'incomplete';
  fields: { postcode?: string; localAuthority?: string };
  sources: { postcode?: string; localAuthority?: string };
};
type Options = { fetch?: typeof fetch; apiKey?: string };
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const normal = (value: string | null | undefined) => (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const cache = new Map<string, { expires: number; result: SiteLookupResult }>();

/** Fill only absent fields. Street searches require an exact, unique property match. */
export const lookupSiteAddress = async (input: SiteLookupInput, options: Options = {}): Promise<SiteLookupResult> => {
  const address = normaliseUkAddress(input);
  const country = normal(address.country);
  if (country && !['united kingdom', 'uk', 'gb', 'gbr', 'scotland', 'england', 'wales', 'northern ireland'].includes(country)) {
    return { status: 'incomplete', fields: {}, sources: {} };
  }
  if (address.postcode && address.localAuthority) return { status: 'verified', fields: {}, sources: {} };
  const apiKey = options.apiKey ?? process.env.IDEAL_POSTCODES_API_KEY?.trim();
  const cacheKey = createHash('sha256').update(JSON.stringify([address, Boolean(apiKey)])).digest('hex');
  const cached = !options.fetch && cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.result;
  const fields: SiteLookupResult['fields'] = {};
  const sources: SiteLookupResult['sources'] = {};
  const get = async (url: string | URL, headers?: HeadersInit) => {
    const response = await (options.fetch ?? fetch)(url, { headers, signal: AbortSignal.timeout(5000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Address lookup unavailable');
    return object(await response.json());
  };
  const run = async (): Promise<SiteLookupResult> => {
    let postcode = normalisePostcode(address.postcode);
    if (address.postcode?.trim() && !postcode) return { status: 'not_found', fields, sources };
    if (!postcode) {
      if (!address.buildingNumber || !address.addressLine1 || !address.townCity) return { status: 'incomplete', fields, sources };
      if (!apiKey) return { status: 'not_configured', fields, sources };
      const url = new URL('https://api.ideal-postcodes.co.uk/v1/addresses');
      url.searchParams.set('query', [address.buildingNumber, address.addressLine1, address.addressLine2, address.townCity].filter(Boolean).join(' '));
      url.searchParams.set('limit', '100');
      const payload = await get(url, { Authorization: `Bearer ${apiKey}` });
      if (!payload) return { status: 'not_found', fields, sources };
      if (payload.code !== 2000) throw new Error('Address lookup unavailable');
      const result = object(payload.result);
      const hits = Array.isArray(result.hits) ? result.hits.map(object) : [];
      if (hits.length >= 100) return { status: 'ambiguous', fields, sources };
      const exact = hits.filter(hit => {
        const street = [text(hit.dependant_thoroughfare), text(hit.thoroughfare)].filter(Boolean).join(' ');
        const localities = [hit.post_town, hit.dependant_locality, hit.double_dependant_locality].map(value => normal(text(value)));
        return addressIdentity({ buildingNumber: text(hit.building_number), addressLine1: street }) === addressIdentity(address)
          && !text(hit.sub_building_name) && !text(hit.building_name)
          && localities.includes(normal(address.townCity))
          && (!address.addressLine2 || [hit.dependant_locality, hit.double_dependant_locality, hit.line_2, hit.line_3]
            .some(value => normal(text(value)) === normal(address.addressLine2)));
      });
      if (exact.length !== 1) return { status: exact.length > 1 ? 'ambiguous' : 'not_found', fields, sources };
      postcode = normalisePostcode(text(exact[0].postcode));
      if (!postcode) throw new Error('Address lookup unavailable');
      fields.postcode = postcode;
      sources.postcode = 'Ideal Postcodes: exact building number, street and locality match';
    }
    if (!address.localAuthority?.trim()) {
      const payload = await get(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
      if (!payload) return { status: 'not_found', fields, sources };
      const result = object(payload.result);
      if (payload.status !== 200 || normalisePostcode(text(result.postcode)) !== postcode) throw new Error('Postcode lookup unavailable');
      const district = text(result.admin_district);
      if (district) {
        fields.localAuthority = text(result.country) === 'Scotland' && !/council$/i.test(district) ? `${district} Council` : district;
        sources.localAuthority = `Postcodes.io: administrative district for ${postcode}`;
      }
    }
    return { status: Object.keys(fields).length ? 'verified' : 'not_found', fields, sources };
  };
  const result = await run().catch((): SiteLookupResult => ({ status: 'unavailable', fields, sources }));
  if (!options.fetch) {
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { expires: Date.now() + (result.status === 'verified' ? 300_000 : 30_000), result });
  }
  return result;
};
