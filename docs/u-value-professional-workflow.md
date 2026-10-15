# Professional U-value workflow

## UX decision brief

The job is to prepare a referenced element calculation, check it, and issue a reproducible report for a project. Architects will repeat this task across several elements and revisions. Keep the portal's existing fields, native selects and full-size buttons. The calculator remains a single workbench; a saved report has its own review screen.

The primary path is project → element/method → referenced inputs → calculated result → saved draft → review → issue. Editing a saved report creates a revision; earlier snapshots remain available. Loading a construction template creates a fresh draft without copying project identity or review status. Errors preserve entered values. A revision conflict asks the author to load the latest revision rather than silently overwriting it.

## Task ergonomics contract

- Use on desktop and touch screens; controls at least 44px where practical, visible labels and units.
- Keep calculations live, but require explicit confirmation of method applicability and corrections before saving.
- Validate at the shared calculation boundary and repeat on the server. Never accept a browser-supplied result or review identity.
- Separate calculated results from externally assessed U-values and component-based opening calculations.
- Save immutable calculation snapshots. Review and issue actions record the actor, timestamp and exact input fingerprint.
- Do not allow a stale revision to be issued. A new revision does not alter the historical issued report.
- Evidence: existing engine regressions, portal adapter benchmarks, organisation isolation, duplicate requests, revision conflicts, review transitions, browser recovery, mobile layout and printed reports.

## Acceptance boundary

This is standards-based calculation software, not independently certified software. Supplying a review statement is a professional workflow action, not external certification. The supplied engine's tests are evidence for the tested methods and examples; they do not establish equivalence to BuildDesk or blanket compliance with every clause of current standards.

Numerical mesh analysis and native light-steel/UK-specific proprietary methods remain outside the portal's issueable scope pending qualification. Specialist ground and roof methods expose their applicability conditions and require an assessment reference. Material declarations must be converted to appropriate design values where required.

## Verification completed 15 October 2026

- Original backend: all 123 tests pass; JavaScript mathematics is unchanged.
- Portal regression groups: plane/ground/cavity/correction/product handling, published wall examples and 40 section mappings pass.
- Additional forms: 14 method/assessment types pass calculation, schema, restored-draft and applicability tests; independent opening/rain/unheated arithmetic and roof surface conventions are checked. Edge insulation, taper and basement mappings match the supplied fixtures. Demonstration fixtures are explicitly not native BuildDesk golden results.
- Review/revision tests cover duplicate and concurrent requests, stale-base rejection, issue/revision races, legacy nullable series, withdrawal, project isolation, authenticated identities, CSRF and fresh template assessments.
- Real browser fixture: every new form, live result, opening-area error, applicability gate, mobile layout, saved report, lost review response and retry, issue, revision, supersession, withdrawal, template loading and project PDF pack pass without browser errors.
- Actual configured PostgreSQL/Prisma services: temporary practice/user/calculation records exercise save, retry, review, issue, revision, stale-base rejection, event storage and template storage in one deliberately rolled-back transaction. Rollback was verified; no customer data was used.
- The additive database migration was applied and checked. Calculation, review and template tables have RLS enabled and no anon/authenticated browser-role access.
- Source type check and production build pass. Existing unrelated TypeScript hints remain in DirectoryEditor and CertifierSettings.
- Example basement and taper reports, issued opening report and project pack were rendered to A4 PDFs and inspected. Numerical display precision is bounded for legibility; calculation snapshots and target comparisons retain full numeric precision.

## Release work still requiring evidence or review

1. Obtain populated native runtime fixtures and the UK steel-method evidence described in the REA/Ghidra handoff. There is currently no claim of BuildDesk/Elmhurst equivalence.
2. Complete an independent clause-by-clause thermal-method review against the applicable standards and UK conventions, especially the engine's ground approximation choices and specialist roof applicability. The software's own Review/Issue workflow does not substitute for this validation of the software.
3. Qualify numerical heat-flow analysis before exposing steel/mesh families; the supplied solver's limited reference cases do not establish full ISO 10211 qualification.
4. Expand and maintain the sourced design-material library and richer build-up editing for methods that currently consume assessed R/U inputs. Whole-building energy, condensation and product/frame-profile simulation remain separate products/methods.
5. Deploy the portal build through the normal release process. Database migration is already applied; the code in this checkout has not been deployed by this task.
