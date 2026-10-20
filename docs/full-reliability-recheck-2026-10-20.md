# Full reliability recheck — 20 October 2026

The earlier fixes were rechecked by tracing their UI, API, stored state and Agent boundaries, running the existing regression suites and adding controlled failure cases where coverage was missing. This pass includes the two portal corrections described in the earlier 20 October review.

Four additional problems were reproduced and corrected. The final portal build and automated checks passed. No customer application was run, restarted, submitted or paid for, and no deployment was performed.

## Additional corrections

| Problem | Reproduction | Correction |
| --- | --- | --- |
| Stale queue cleanup recorded an interruption after a renewed heartbeat, a start, cancellation or a replacement claim. A project deleted during cleanup could make reconciliation throw. | Five controlled interleavings failed against the previous service. | Re-read the exact job, run, device, status and expired lease after acquiring the organisation execution lock. Only then record the interruption or change the job. Eight tests now cover the races, real expiry and repeat cleanup. |
| A unique saved-client name match required a manual choice if scanned contact details differed, contrary to the requested default behaviour. | The real-component browser test could not observe automatic selection with a differing email/address. | The uniquely matched saved record supplies the defaults. An explicit existing client ID remains authoritative; duplicate names remain unresolved; edits made during lookup are protected. |
| A save acknowledgement could overwrite typing that occurred before the response was applied to the form. | A controlled input event between acknowledgement and response synchronization failed to survive against the previous component. | Skip response synchronization when there are newer unsaved edits. The existing autosave loop then saves the latest values. Tests cover typing during a slow save, rapid relationship changes and the acknowledgement timing gap. |
| A failed category save rolled back the entire form, losing other fields edited while that request waited. | A delayed failed category save restored the old email in the browser. | Restore only that document's previous category and review status. Keep other fields and drawing metadata, and verify that the retained edits save successfully on retry. |

Two older source-text tests still asserted the superseded client layout or old retry-status implementation. They were updated to the current form and shared recovery contract. Their behavioural protections remain covered by the client browser, prepared-edit and atomic postcode-recovery tests. No obsolete UI was added to make a test pass.

## Earlier-fix coverage

| Earlier fix family | Evidence rechecked | Result and scope |
| --- | --- | --- |
| Client name matching, saved defaults and editable corrections | Client identity/directory/correction service tests; full client/applicant browser suite | Passed, including unique defaults with differing scanned details, exact-ID precedence, duplicate-name ambiguity, late responses and retained corrections. |
| Native client dropdown, standard buttons, readable saved-client indicator and removed source text | Real-component browser checks, including 205 clients across pages and keyboard selection | Passed, with desktop/mobile layouts and no browser runtime errors. |
| Client/applicant relationship and site-address reuse | Client browser suite and persisted review tests | Passed, including separate-applicant edits surviving relationship changes and client corrections. The relationship control's design was retained. |
| Removed client-only save-and-continue action | Current shared form, existing review UI tests and client browser flows | Verified in the full review layout; project creation remains the final action for the complete form. |
| Shared description of work | `application-description-reuse.test.ts`, preparation validation and snapshot contracts | Passed: existing application edits take precedence; missing values reuse the reviewed description; no replacement with general project notes. |
| Prepared Building Warrant edits and exact application identity | `warrant-prepared-edit.test.ts`, customer preparation save, preparation snapshot races | Passed, including refusal when an Agent claims the attempt during an edit. |
| Clear review action and offline/reconnected status | `customer-agent-recovery.spec.ts` against the actual live-card/settings components | Passed: offline, reconnect, status outage, running progress, reset confirmation and mobile layout. No fixture mutations were made. |
| Safe restart after authentication failure | Login/restart recovery suites, atomic postcode recovery and native login tests | Passed: fresh authorised attempts, unchanged historical snapshots, retained corrections, invalid/late-state rejection and organisation/device scope. |
| Queue withdrawal and cancellation | Queue/cancellation endpoint suites and native cancellation tests | Passed: retained prepared applications, exact job/run identity, release acknowledgement, stale commands and late callbacks. |
| Deleted/reassigned-job release and heartbeat completion races | Agent recovery/execution/review-lease suites and native polling tests | Passed, including the newly corrected stale-cleanup cases. Database concurrency tests use deterministic doubles. |
| Supporting documents independent of legacy global settings | Actual Building Warrant workflow exercised with isolated inputs and Selenium doubles | Passed for missing legacy JSON, unrelated legacy data and extra unrelated PDFs; only the job's mapped files are selected. |
| Upload retry, same-name PDFs, MIME fallback, incomplete batches and lost responses | Upload/service/helper suites and browser recovery checks | Passed: bounded retries, stable hashes, distinct changed contents, workers drained, retained completed files, reconciled removal and blocking creation for unfinished uploads. |
| Review preservation through document changes and reanalysis | Portal draft lifecycle/concurrency tests and browser recovery suite | Passed, including new category placeholders adopting analysis results while explicitly accepted categories and drawing edits persist. |
| Cancellation/create/cleanup/finalisation races | Real service code with controlled interleavings | Passed: no deletion when project creation wins, no resurrection by late saves and no commit using an obsolete or unfinished document set. |
| Unicode headers and Windows filenames | Portal header tests and native filesystem tests | Passed for accented/CJK/emoji names, control characters, reserved names, UTF-16 path limits and duplicate names. |
| Review-browser commands cannot disturb active jobs | Native GUI and polling suites; released-review endpoint tests | Passed: deferral, exact ownership, retained sessions, successor waiting and retired callbacks. |
| Update progress, failed-update recovery, connection identity and settings | Native updater, GUI, enrollment, instance and reset suites | Passed: bounded retries, preserved claim/release state, connection and settings; second-launch routing; explicit update-blocking during active execution. |
| Installer handover and file-lock avoidance | Actual isolated installer upgrade smoke test | Passed: legacy/versioned processes close, settings persist, one new Agent starts, unrelated installation remains running. The user's installed Agent was not replaced. |
| Release/download consistency | Integrity test, byte comparison of all 137 archive entries and read-only production metadata request | Passed: local Agent 4.2.8 size/hash and source match. Production also advertised 4.2.8 during this recheck; the additional portal corrections are still local. |
| Related portal workflow and calculation regressions | Existing orchestration and U-value suites | Passed with isolated fixtures; this does not constitute independent certification or a new assessment of supported calculation standards. |

## Final verification

- **400 native Agent tests plus four subtests passed.** One existing PyPDF2 deprecation warning remains.
- **23 portal lifecycle/helper tests and eight stale-cleanup tests passed.** Existing upload retry/category-edit checks also passed.
- **70 browser checks passed:** 43 client/applicant checks and 27 portal recovery checks, with no browser runtime errors.
- The additional offline/reconnect/status-outage Playwright scenario passed.
- `npm run test:release-reliability` passed all eight suite groups: security, login recovery, Agent reliability, portal reliability, earlier fixes, state model, fees and addresses.
- Existing orchestration and U-value backend/portal suites passed. Local HTTP/worker tests required loopback access; the restricted run was interrupted and rerun with the required local permissions.
- The installer smoke test passed. The installer checksum/size and all 137 archived source entries match Agent 4.2.8.
- `npm run check`: **0 errors, 0 warnings, 4 hints**. Three hints predate this work; one suggests an async conversion in the deliberately timed browser fixture.
- `npm run build`: **passed**, including Vercel function bundling.

The fast-edit failure was not dismissed as a flaky test: it was reproduced with controlled response timing, corrected, and rechecked with the original client/applicant suite.

## Repeatable checks and release status

Run `npm run test:release-reliability` for the combined server/contract checks, `npm run test:portal-reliability:browser` for recovery interactions, and `npx tsx tests/client-applicant-review.browser.mjs` for the full client/applicant form. The offline/reconnect fixture runs with `npx playwright test tests/customer-agent-recovery.spec.ts --workers=1`. The native suite runs with `python -m pytest -q` from the Agent checkout.

The combined command includes older tests that were previously absent from the main scripts. It is a reusable release check, not an automatically enforced Vercel deployment gate.

The additional fixes in this pass are portal changes. Deploy them together with the preceding 20 October corrections. Agent 4.2.8 remains the verified matching installer; no new Agent binary was produced for this pass.

The remaining acceptance check is a supervised complete run on the affected computer and eDevelopment account, including supporting PDFs, the location plan, retained-draft review and the next queued application. These automated checks do not replace that run, a live PostgreSQL concurrency stress test, or a forced-process-termination test. They establish the exercised behaviours and corrected failures, not a guarantee of zero defects.
