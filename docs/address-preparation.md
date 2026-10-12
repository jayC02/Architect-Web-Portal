# Address preparation

The draft preparation and review form separate a leading building number from the street, extract a postcode embedded in address lines and retain source evidence. Older prepared drafts are repaired when opened and saved. Explicit conflicting numbers, flat identifiers and uncertain named-building layouts are retained for review. Client and applicant addresses linked to the site stay in sync.

A postcode already found in the drawings (or entered by the architect) is used to look up the local authority through Postcodes.io. Missing postcodes can be filled using Ideal Postcodes: set `IDEAL_POSTCODES_API_KEY` on the server with an appropriately licensed account. Without that key, address parsing and postcode-to-council lookup still work. No key or account has been provisioned by this change.

Street searches fill a postcode only for one exact building-number, street and locality match. Ambiguous, incomplete and failed lookups leave the fields editable. Requests are debounced and organisation scoped, with existing origin and rate-limit guards. Timeouts and a bounded short-lived cache keep a failed provider from blocking preparation. Architect-entered values are preserved; edits cancel stale responses. Changing property details clears values supplied by the current lookup so they cannot silently carry into another property. Queued automation snapshots are unaffected.

Record matching includes the property number as well as the street, retaining common street abbreviations and legacy addresses with the number in line 1.

## Verification

- `npm run test:addresses`: parser, postcode formatting, number suffixes/ranges, flats, neighbours, exact provider matches, ambiguous results, failures, manual values and mismatched postcode responses.
- TypeScript and existing application draft, review, preparation and document classifier/sorter regressions.
- `node scripts/verify-site-address.mjs`, followed by `node scripts/verify-site-address-browser.mjs`: production React form with simulated API responses. Covers automatic fields, autosave, linked addresses, stale responses and stale values, ambiguous/provider-error states, mobile width and keyboard entry. Uses the installed Chrome browser; no real records or paid lookups.

Provider references: [Ideal Postcodes API](https://openapi.ideal-postcodes.co.uk/) and [Postcodes.io postcode fields](https://postcodes.io/docs/postcode/schema/).
