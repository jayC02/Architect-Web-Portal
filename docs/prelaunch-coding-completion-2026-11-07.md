# Pre-launch coding completion — 7 November 2026

This replaces the outstanding-coding list in the 6 November handoff. The pre-launch implementation is complete in source. Deployment, database migration application, installer release and live government-portal acceptance are separate steps and have not been performed.

## Implemented

The preparation flow now connects website fields, saved application data, the frozen v2 job, the actual Agent adapter and production warrant runner. The temporary unmapped-branch launch blockers and unsupported-question pauses have been replaced with handlers and field-specific validation.

- Project screening stores Residential/Commercial and every selected work type on the project. Both direct project creation and application-draft creation support it. Existing projects can complete screening through the scoped editor. Preparation reads those authoritative choices; it does not ask them again. Missing or unknown screening blocks launch instead of inventing a building use/type.
- Screening edits invalidate only unstarted, unauthorised READY warrant reviews. Authorised, claimed, running, historical and other-organisation/project jobs retain their snapshots.
- Ownership No can reuse the saved client or collect a separate owner. Required title, contact and address details are validated before login. The chosen owner is copied into the prepared job.
- Construction/existing-building/conversion/demolition/new-building flags come from the selected work types. Proposed-work checkboxes support multiple selections, clear obsolete selections, and include an explicit provision-of-services choice that survives both Agent import paths.
- Conversion selects the applicable C1–C10 descriptions. Demolition accepts whole weeks 1–99 and clears Months. Listed/conservation Yes fills the listing category/details, maximum 750 characters.
- Fire and Rescue Yes continues directly; No fills the per-application authority name, maximum 20 characters. Historical importance and dangerous-building Yes require and fill details/references, maximum 750 characters each.
- Relaxation directions support multiple reference/date rows, with valid dates entered as dd/mm/yyyy. The single-row legacy representation remains compatible. Multiple-row addition observes a scoped Add control and verifies the resulting rows; it does not invent an Add-button ID.
- Construction certification uses one Yes/No selection, conditional certificate availability and the captured scheme, certifier, registration, approved-body and work-details fields. STAS uses its approval reference, maximum 20 characters, for commercial or new-build projects; residential non-new-build projects send No.
- Design certification can be No without supplying registration fields. Selecting it requires the saved registration details, certificate availability and the appropriate timing. Native validation finds the real Validation Check control by its visible button text/value, observes a fresh result and reports a corrective message on rejection. It no longer clicks the approved-body text box as a validation button.
- A certificate rejection provides a direct canonical-editor link. A fresh retry copies corrected certificate details while preserving the earlier run's frozen data.
- Sustainability supports the captured domestic/non-domestic grids and both observed screen orders. Each selected matrix is completed once. Emissions offers all five levels; the remaining rows allow Silver or Gold. Multiple-building counts are validated and cleared when not applicable.
- Work started is fixed No per the user's latest instruction, including fee calculation. Staged, limited-life and public-inspection restrictions are hidden/fixed No under the launch policy. Ownership, Fire and Rescue and dangerous notices remain selectable under the later user instructions.
- Estimated value is required and positive; no invented value/use defaults remain. Replayed notice fields replace rather than append. Checklist/supporting-document answers reflect the actual prepared document list, including location-plan-only jobs. Portal transitions verify observed destination controls and do not blindly repeat uncertain Next clicks.
- Declaration authorisation is collected before launch. The Agent cannot complete the declaration without it; submission and payment remain the user's responsibility.
- Generic job review presents warrant answers read-only and links to the dedicated preparation editor. Its save route preserves the canonical answers instead of replacing them with absent/defaulted inputs.
- Native hidden-field behavior now takes precedence over grid/flex CSS, preventing conditional owner/follow-up controls appearing prematurely. This is a functional visibility fix, not a redesign.

## Security, state and housekeeping

- Agent portal origins are explicitly restricted; handoff links cannot persist a replacement server. Document paths and redirects cannot send bearer tokens to another origin.
- Updates validate their release origin and require user confirmation before installer launch, with a second active-run check after confirmation.
- Google sign-in cannot automatically link a password account solely by matching email. An authenticated settings connection uses a nonce bound to the signed-in user; signup-completion races are covered.
- Rate limiting ignores the spoofable Cloudflare header in this deployment.
- A manual-input pause is no longer shown as Prepared/final review. Final review requires the actual final-review outcome; paused progress is shown as needs input at 0%.
- Per-job tokens are cleared for COMPLETED, FAILED_RETRYABLE, FAILED_FINAL and CANCELLED callbacks after delivery.
- The workflow-effects retry cron is configured at 07:00 UTC daily. The schedule fits the documented daily limit; no cron was deployed. Reference: https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing .

## Verification

- Full Agent suite: **652 passed**, plus four subtests. One existing PyPDF2 deprecation warning remains.
- Website `npm run test:release-reliability`: passed all eight groups, including the new screening, mapping, certificate-recovery and authentication regressions.
- `npm run check`: zero errors, zero warnings and four existing hints. Production build passed.
- Application-card browser suite: 73 checks passed. Portal-review browser suite: 29 checks passed. Both reported no browser runtime errors.
- Production warrant-form browser check passed: the actual built preparation page is rendered with isolated database/session delegates, actual client scripts and built CSS. It checks optional design certification, owner reuse/manual controls, conditional requirements, conversion/demolition/services controls, repeated relaxation rows, construction certification, both sustainability matrices, serialization and mobile width.
- Native tests exercise an actual saved v2 snapshot through the adapter and production runner with combined follow-ups. They cover both sustainability orders, stale controls, repeated directions, certificate result handling and location-plan-only documents.
- Git whitespace checks passed. Source edits remain uncommitted; existing unrelated Agent changes were preserved.

Logs:

- Website: `D:/Jayveer/Documents/websites/Architect Web Portal/output/prelaunch-checks/`.
- Agent: `C:/Users/Jayveer/Building Portal/output/prelaunch-checks/native-tests.log`.
- Browser artifacts: website `output/warrant-follow-ups/`, application-card and portal-review test output directories. These are test artifacts, not design proposals.

## Release requirements and verification limits

1. Review and apply `D:/Jayveer/Documents/websites/Architect Web Portal/prisma/migrations/20261106190000_project_screener/migration.sql` to the intended database before running/deploying this version. Prisma client generation was local only; no live database was migrated. Existing projects deliberately have no guessed building use and need confirmation before warrant launch.
2. Build/release and install the updated Agent together with the website changes. The installed/published installer was not changed by this coding pass. Deploying the website alone would leave older Agents without these handlers.
3. Perform the supervised disposable-draft acceptance runs in the supplied brief. No real government application was created, edited, submitted or paid for during verification. The exact live certificate-validation result markup and relaxation Add markup were not captured; their handlers use observed controls and stop safely on ambiguity. Automated local checks are not live-portal proof.

The old nested website copy was left untouched and is not used. Deleting it was a document housekeeping suggestion, not an executed destructive operation. Items explicitly labelled “Soon after launch” in the original brief, such as installer signing and a shared rate-limit store, remain outside this pre-launch coding scope.

## Handoff for design

Claude owns visual design. Preserve the existing input names, conditional data attributes, canonical editor boundaries and the validated website-to-Agent data flow. The earlier bare browser-test screenshot was not a proposed site design. Read the current code and this report instead of the superseded first-pass remaining-work list.
