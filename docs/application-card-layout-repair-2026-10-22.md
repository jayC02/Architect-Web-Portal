# Application card layout repair — 22 October 2026

The Planning and Building Warrant cards used equal-height grid items, full-height card containers and expanding details grids. A longer error in one card stretched its neighbour and distributed that extra height between the neighbour's fields.

The cards now align at the top and size to their own content. Details rows retain their normal spacing, footers follow those rows, and long text wraps within each card. The no-job status footer wraps its action group according to available card width. Existing button styles, labels and automation behaviour are retained. Error messages remain readable; they are not truncated to impose a fixed height.

Chrome DevTools reproduced the original coupling: opening Planning's Technical details grew both cards from 576 to 600 pixels and moved the Building Warrant fields. With the correction, the Building Warrant card stayed at 420 pixels with unchanged field positions while Planning expanded. The isolated browser regression also verifies the reverse case.

Verification uses the actual Astro summary/status components, hydrated React controls and the applications grid classes extracted from the project page. Its local Astro project has no application middleware, database or real accounts. API failures are local fixtures.

- **30 browser checks passed** across 320, 390, 768, 1024, 1280 and 1600 pixel widths. These cover errors in either card, expanding technical details, long unbroken names and request errors, button containment, empty/ready/running/review/submitted states and keyboard operation. No browser runtime errors.
- Existing project-workspace and desktop-status regression tests passed.
- Astro check: **480 files, zero errors and zero warnings**; four existing hints.
- Production portal build passed.
- Reproduce the browser checks with `npm run test:application-layout:browser`.

Local screenshots: `output/application-card-layout/desktop-planning-error.png`, `desktop-building-warrant-error.png` and `mobile-long-error.png`. Logs: `output/application-card-layout-check.log`, `application-card-layout-types.log` and `application-card-layout-build.log`.

This is a portal layout correction. It does not require a new Agent version beyond the already prepared 4.2.11 release. Deployment is not performed by these checks.
