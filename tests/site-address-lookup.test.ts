import assert from 'node:assert/strict';
import { normaliseUkAddress, normalisePostcode, addressIdentity } from '../src/lib/addresses/uk-address';
import { lookupSiteAddress } from '../src/server/services/site-address-lookup.service';
import { scoreSiteMatch } from '../src/server/services/application-draft-matching.service';
import { documentFactSchema } from '../src/lib/validation/document-intelligence';

const address = { buildingNumber: null, addressLine1: '105 Ralston Avenue', addressLine2: null,
  townCity: 'Crookston', postcode: null, country: 'United Kingdom', localAuthority: null };
const parsed = normaliseUkAddress(address);
assert.equal(parsed.buildingNumber, '105');
assert.equal(parsed.addressLine1, 'Ralston Avenue');
assert.equal(address.buildingNumber, null, 'parsing does not mutate the input');
assert.deepEqual(normaliseUkAddress(parsed), parsed, 'normalisation is idempotent');
assert.equal(normaliseUkAddress({ addressLine1: '105A Ralston Avenue' }).buildingNumber, '105A');
assert.equal(normaliseUkAddress({ addressLine1: '12 \u2013 14 High Street' }).buildingNumber, '12-14');
assert.equal(normaliseUkAddress({ addressLine1: '105/2 Ralston Avenue' }).buildingNumber, '105/2');
assert.deepEqual(normaliseUkAddress({ addressLine1: 'Flat 2, 105 High Street' }), { addressLine1: 'Flat 2, 105 High Street' }, 'flat street details are not mistaken for a town');
assert.equal(normaliseUkAddress({ addressLine1: 'The Lodge, High Street', townCity: 'Glasgow' }).buildingNumber, undefined);
assert.equal(normaliseUkAddress({ buildingNumber: '106', addressLine1: '105 Ralston Avenue' }).addressLine1, '105 Ralston Avenue', 'explicit conflicting numbers remain visible');
const full = normaliseUkAddress({ addressLine1: '105 Ralston Avenue, Crookston, g52 3qh' });
assert.deepEqual(full, { buildingNumber: '105', addressLine1: 'Ralston Avenue', townCity: 'Crookston', postcode: 'G52 3QH' });
assert.equal(normaliseUkAddress({ addressLine1: '105 High Street', addressLine2: 'Glasgow, G1 1AA', postcode: 'EH1 1AA' }).addressLine2, 'Glasgow, G1 1AA', 'conflicting postcodes are retained for review');
assert.equal(normalisePostcode('g523qh'), 'G52 3QH');
assert.equal(normalisePostcode('not a postcode'), null);
assert.equal(addressIdentity(parsed), addressIdentity({ addressLine1: '105 Ralston Ave.' }));
assert.equal(scoreSiteMatch({ id: 'site', buildingNumber: '106', addressLine1: 'Ralston Avenue', addressLine2: null,
  townCity: 'Crookston', postcode: 'G52 3QH' }, { ...parsed, postcode: 'G52 3QH' })?.strength, 'possible', 'neighbours cannot become a strong match');
assert.equal(scoreSiteMatch({ id: 'site', buildingNumber: '105', addressLine1: 'Ralston Ave.', addressLine2: null,
  townCity: 'Crookston', postcode: 'G52 3QH' }, { ...parsed, postcode: 'G52 3QH' })?.strength, 'strong');
for (const fieldKey of ['site.buildingNumber', 'applicant.buildingNumber']) {
  assert.equal(documentFactSchema.safeParse({ fieldKey, value: '105', evidence: '105 Ralston Avenue', certainty: 'high' }).success, true);
}
const hit = { building_number: '105', thoroughfare: 'Ralston Avenue', dependant_thoroughfare: '',
  dependant_locality: 'Crookston', post_town: 'Glasgow', postcode: 'G52 3QH', building_name: '', sub_building_name: '' };
const ioResult = { status: 200, result: { postcode: 'G52 3QH', admin_district: 'Glasgow City', country: 'Scotland' } };
function mock(hits = [hit], postcodeResponse: unknown = ioResult, fail = false): typeof fetch {
  return (async (url, init) => {
    if (fail) throw new Error('offline');
    const target = new URL(String(url));
    assert.equal(init?.signal?.aborted, false);
    if (target.hostname === 'api.ideal-postcodes.co.uk') {
      assert.equal(new Headers(init?.headers).get('authorization'), 'api_key="test-key"');
      assert.equal(target.searchParams.has('api_key'), false, 'credentials stay out of URLs');
      return Response.json({ code: 2000, result: { hits } });
    }
    assert.equal(target.hostname, 'api.postcodes.io');
    return Response.json(postcodeResponse);
  }) as typeof fetch;
}
const verified = await lookupSiteAddress(address, { fetch: mock(), apiKey: 'test-key' });
assert.equal(verified.status, 'verified');
assert.deepEqual(verified.fields, { postcode: 'G52 3QH', localAuthority: 'Glasgow City Council' });
assert.ok(verified.sources.postcode && verified.sources.localAuthority);
assert.equal((await lookupSiteAddress(address, { fetch: mock([hit, hit]), apiKey: 'test-key' })).status, 'ambiguous');
assert.equal((await lookupSiteAddress(address, { fetch: mock([{ ...hit, building_number: '106' }]), apiKey: 'test-key' })).status, 'not_found');
assert.equal((await lookupSiteAddress(address, { fetch: mock([{ ...hit, dependant_locality: 'Elsewhere' }]), apiKey: 'test-key' })).status, 'not_found');
assert.equal((await lookupSiteAddress(address, { fetch: mock([{ ...hit, sub_building_name: 'Flat 2' }]), apiKey: 'test-key' })).status, 'not_found');
assert.equal((await lookupSiteAddress(address, { fetch: mock([], {}, true), apiKey: 'test-key' })).status, 'unavailable');
assert.equal((await lookupSiteAddress(address, { fetch: mock(), apiKey: '' })).status, 'not_configured');
const councilOnly = await lookupSiteAddress({ ...address, postcode: 'g523qh' }, { fetch: mock(), apiKey: '' });
assert.deepEqual(councilOnly.fields, { localAuthority: 'Glasgow City Council' });
const preserveCouncil = await lookupSiteAddress({ ...address, localAuthority: 'Architect confirmed council' }, { fetch: mock(), apiKey: 'test-key' });
assert.deepEqual(preserveCouncil.fields, { postcode: 'G52 3QH' });
let calls = 0;
const neverFetch = (async () => { calls++; throw new Error('unexpected lookup'); }) as typeof fetch;
await lookupSiteAddress({ ...address, postcode: 'G52 3QH', localAuthority: 'Confirmed council' }, { fetch: neverFetch });
await lookupSiteAddress({ ...address, country: 'France' }, { fetch: neverFetch });
assert.equal(calls, 0);
assert.equal((await lookupSiteAddress({ ...address, postcode: 'invalid' }, { fetch: neverFetch })).status, 'not_found');
const mismatched = await lookupSiteAddress({ ...address, postcode: 'G52 3QH' }, { fetch: mock([], { status: 200, result: { postcode: 'EH1 1AA', admin_district: 'Edinburgh' } }) });
assert.equal(mismatched.status, 'unavailable');
assert.deepEqual(mismatched.fields, {});
console.log('Site address parsing, exact matching, lookup and failure tests passed');
