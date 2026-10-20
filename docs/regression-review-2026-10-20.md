# Regression review — 20 October 2026

This review specifically challenged the preceding reliability changes. It found one regression introduced by preserving the saved review across document changes, plus an existing recovery gap in document removal. Both were reproduced before correction. No customer or government records were modified.

The later [full reliability recheck](<D:/Jayveer/Documents/websites/Architect Web Portal/docs/full-reliability-recheck-2026-10-20.md>) covers all earlier fix families, four further corrections and the final verification results.

## Corrections

1. **A new PDF's temporary category could override its analysis result.** After adding a PDF, editing a client detail autosaves the whole review, including the PDF's default `OTHER / IN_REVIEW` entry. The review merge then treated that placeholder as an accepted category and ignored the subsequent classification. The merge now recognises the unreviewed placeholder and uses the analysis result. Explicitly approved categories remain intact, including an approved `OTHER` choice, and entered drawing metadata is preserved. Tests exercise the real preparation and save services with isolated dependencies, including the synthesis step that the earlier concurrency tests did not cover.

2. **A lost DELETE response left an obsolete document list.** The server could remove a PDF successfully while the browser reported a network failure and kept the old row. A subsequent save then contained a removed document ID. The browser now fetches the authoritative draft after a failed removal response and recognises when removal already succeeded. The browser fixture aborts the response after applying the deletion, enforces the real document-ID validation on saves, and verifies that further edits save successfully.

The first new service test failed against the previous source with `OTHER` instead of `LOCATION_PLAN`. The new browser check also failed against the previous source because the removed row remained visible. These checks passed after the corrections.

## Validation

- Portal reliability suite: **23 tests passed**, plus the existing upload retry/category-edit regressions.
- Portal recovery browser suite: **21 checks passed**, including resumed saving after a lost response; no browser JavaScript errors.
- Existing security and client/applicant browser suites passed.
- Astro check and production build passed.

The Agent executable and installer do not require a replacement for these portal-only changes. Deploy these portal corrections as well as the preceding reliability changes. No deployment was performed in this review.

The review does not establish zero defects. The service concurrency checks still use database doubles, and a supervised complete workflow on the affected computer remains outstanding. Test counts describe coverage exercised; they are not a guarantee of production behaviour.
