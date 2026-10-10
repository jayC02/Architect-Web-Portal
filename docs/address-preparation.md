# Address preparation

The draft preparation and review form separate a leading building number from the street, extract a postcode embedded in address lines and retain source evidence. Older prepared drafts are repaired when opened and saved. Explicit conflicting numbers, flat identifiers and uncertain named-building layouts are retained for review. Client and applicant addresses linked to the site stay in sync.

A postcode already found in the drawings (or entered by the architect) is used for administrative-area evidence through Postcodes.io. This does not verify the relevant application authority. Missing postcodes can be filled using Ideal Postcodes: set `IDEAL_POSTCODES_API_KEY`, `IDEAL_POSTCODES_PLATFORM_LICENSED=true` and `IDEAL_POSTCODES_LICENSEES` (a JSON mapping of organisation IDs to provider licensee identifiers) on the server after the platform sublicensing arrangement is confirmed. Without that key, address parsing and postcode-to-council lookup still work. No key or account has been provisioned by this change.

Street searches fill a postcode only for one exact building-number, street and locality match. Ambiguous, incomplete and failed lookups leave the fields editable. Requests are debounced and organisation scoped, with existing origin and rate-limit guards. Timeouts and a bounded short-lived cache keep a failed provider from blocking preparation. Architect-entered values are preserved; edits cancel stale responses. Changing property details clears values supplied by the current lookup so they cannot silently carry into another property. Queued automation snapshots are unaffected.

Record matching includes the property number as well as the street, retaining common street abbreviations and legacy addresses with the number in line 1.

## Verification

- `npm run test:addresses`: parser, postcode formatting, number suffixes/ranges, flats, neighbours, exact provider matches, ambiguous results, failures, manual values and mismatched postcode responses.
- TypeScript and existing application draft, review, preparation and document classifier/sorter regressions.
- `node scripts/verify-site-address.mjs`, followed by `node scripts/verify-site-address-browser.mjs`: production React form with simulated API responses. Covers automatic fields, autosave, linked addresses, stale responses and stale values, ambiguous/provider-error states, mobile width and keyboard entry. Uses the installed Chrome browser; no real records or paid lookups.

Provider references: [Ideal Postcodes API](https://openapi.ideal-postcodes.co.uk/) and [Postcodes.io postcode fields](https://postcodes.io/docs/postcode/schema/).

## Address selection and authority confirmation

Client, site and project forms support debounced autocomplete, cancellation of obsolete requests and manual entry. The server resolves the selected address, retaining UPRN as a string, verification time, provider identity and provenance. Extracted ordinary addresses without document conflicts are verified only against a unique exact number/street/locality match; flat or named-building ambiguity needs selection or manual confirmation. Existing address fields are kept. Lookup metadata supplements the evidence rather than erasing rejected drawing/page candidates.

Administrative, planning and building standards authorities are stored separately. The versioned Scottish routing catalogue offers suggestions only for supported unambiguous council mappings. National parks, boundary uncertainty and missing geography require confirmation. Legacy authority values remain `legacy-unverified`; future snapshots use the confirmed application-specific authority. Already-authorised snapshots are unchanged.

Paid calls are capped per organisation and user, with short-lived organisation-scoped caches and shared identical in-flight requests. API credentials stay out of browser code and request URLs. A failed provider leaves manual saving available.

Ideal Postcodes charges for successful address resolution; autocomplete is a discovery step. Confirm the current [pricing](https://ideal-postcodes.co.uk/pricing) and [platform sublicensing terms](https://docs.ideal-postcodes.co.uk/docs/guides/sublicensing/) with the provider before enabling organisations. No account, credits or licence purchase was made here. Provider outages, flats, named buildings, UPRN, national parks and licence boundaries have mocked test coverage; a licensed live test remains required.

Pricing checked on 10 October 2026: the public pay-as-you-go packs list 200 credits for £9 (4.5p per lookup), 1,100 for £42 (approximately 3.8p), and 4,300 for £155 (approximately 3.6p). Credits last 12 months. Searches while typing are free; successful full-address retrieval spends a credit. These are published ordinary-account prices, **not a platform sublicensing quote**. Architect Pro needs a provider-approved sublicensing key and a licensee for each participating organisation; confirm the applicable price and datasets before configuring the organisation-to-licensee map.
