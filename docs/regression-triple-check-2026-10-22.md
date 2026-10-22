# Regression triple check — 22 October 2026

This review checked the earlier fixes through three different kinds of evidence: the changed state transitions and their callers; fresh automated failure and normal-path tests; and the release artifacts, compiled application and installer handover. It does not establish that an external government portal can never fail.

At the start, Agent 4.2.10's installer size/hash matched its manifest and all 138 archived entries matched the current native source. Its complete **434-test suite plus four subtests** passed. The portal's eight release-reliability groups also passed before this pass changed production code.

## Finding and limited correction

The review found one remaining overlap between existing features: an update was blocked during reset/reconnect, but a reset/reconnect request could still begin during an update. Portal protocol links could reach those same entry points. Connection changes could also enter while an account dialog was open or shutdown was underway.

Agent **4.2.11** adds an entry guard to `AutomationAgent.begin_agent_enrollment` and `AutomationAgent.reset_agent_connection`. The guards leave update/shutdown status alone and ask the user to close an account dialog before changing the connection.

Twelve additional cases check:

- Reset and Reconnect cannot start during an update, an account dialog or shutdown: eight cases through the actual protocol handler.
- Both actions remain usable after an unsuccessful update: two cases.
- The normal Settings buttons still dispatch after the **real Qt modal dialog** closes: two cases. These use Qt timers/event loops and verify the dialog is closed before the connection action starts.

These cases were added to `C:/Users/Jayveer/Building Portal/tests/test_login_settings_reliability.py`. Existing assertions for the earlier fixes were retained. The audit-only full run passed **446 tests plus four subtests**. After the additional address/location work below, the final complete run passes **460 tests plus four subtests**.

The exploratory pre-correction negative probes entered forbidden worker construction. Two probe processes subsequently exited during Qt failure reporting; those partial runs are diagnostic output and are not counted as completed checks. The final fixture retains its QApplication and rejects unexpected worker construction immediately. Successful paths are covered by the real modal-dialog tests and the existing real reset-worker test. No installed Agent or real credentials were used in these probes.

## Location-plan fallback and address chooser

The user reported two further problems during this review. Both were handled in the same unpublished 4.2.11 release.

The Agent already selected a site/block PDF when no explicit location-plan PDF existed. Portal readiness, preparation and preflight still required the exact `LOCATION_PLAN` classification, so a completely reviewed site plan could produce a missing-document blocker. A shared resolver now aligns those checks and the review counter. The server marks the selected fallback as a required snapshot download while preserving its reviewed classification. An explicit location plan takes priority; multiple explicit location plans still require review; ordinary proposed drawings do not qualify. Tests exercise browser/server readiness, review gates, the actual snapshot builder, preparation, and native upload buckets. A before/after probe against the committed readiness function reproduces and removes the erroneous blocker using the same fixture.

Read-only inspection of job `28c91d82-8cb7-4799-a15c-b81b90e736bf` for **147 Blackhill Drive, Glasgow, G23 5NN** confirmed `FAILED_RETRYABLE`, `ADDRESS_RESOLUTION_FAILED`, `address_selection`, Agent **4.2.10**, and an execution-release event. The stored result contains a general error summary, not the underlying Selenium exception; it cannot establish the precise historical failing control.

Source review found two paths that could bypass the chooser: an optional refined search before showing an unmatched postcode list, and errors while resizing/paging the results. A before/after probe against the published 4.2.10 source archive reproduces the first path: a simulated refined-search failure stops before the resolver; the corrected code instead shows the existing list and continues after explicit selection. Interactive runs now show unmatched results directly. If collection fails, a typed recovery request offers only freshly read visible rows, labelled as an incomplete list, with postcode/manual/cancel actions. No cached page/row or partial-list uniqueness is used to make an automatic selection. Browser/session failures still propagate. Live-row uniqueness and selected-address readback checks remain before confirmation.

The additional native cases cover both application routes, failed page-size/pagination postbacks, repeated results, selection/manual/cancel actions, current-page reacquisition, explicit-location priority and upload-once mapping. Two tests run the actual modal Qt address dialog inside the proposal flow: it is visible, Continue is disabled until selection, no proposal exists while it waits, and the chosen row resumes the workflow. Existing postcode-correction/fresh-attempt and wrong-property readback tests remain passing.

## Fresh verification of earlier fixes

The detailed earlier-fix inventory is retained in [the full reliability recheck](./full-reliability-recheck-2026-10-20.md) and [the login/Settings recheck](./agent-login-settings-recheck-2026-10-20.md). The following checks were run again on 22 October.

| Area | Evidence and result |
| --- | --- |
| Login/password toggle, selected account, removed credentials, ready jobs and retired-attempt recovery | Complete native suite: **460 passed, four subtests passed**. Includes all earlier login/Settings regressions and the new positive-path cases. |
| Supporting-document mapping, downloads, filenames, cancellation, queue release, callback ownership, updates and retained browser commands | Complete native suite passed; portal Agent-reliability, login-recovery and state-model groups passed. |
| Portal uploads, partial failures, lost responses, review preservation, category rollback, autosave timing and creation/deletion races | Portal-reliability server tests and **29 recovery browser checks passed**, including the new site-plan role and review-counter checks. No browser runtime errors. |
| Saved-client defaults, editable corrections, original controls, site-address reuse, client/applicant relationship and responsive layout | **43 client/applicant browser checks passed**. No browser runtime errors. |
| Prepared-application edits, shared work description, fresh retries, queue removal and cancellation, security and ownership | All eight groups in `npm run test:release-reliability` passed. |
| Agent offline/reconnect/status-outage UI | Additional real-component Playwright scenario passed. |
| Related orchestration and calculator behaviour | `npm run test:orchestration` and `npm run test:u-values` passed using their fixtures and local workers. No messages, invoices or live-account changes were sent. |
| Installer handover | Passed with an isolated real Inno fixture: legacy/versioned processes close, settings remain, one new process starts and an unrelated installation remains running. |

One existing PyPDF2 deprecation warning remains. The automated runs use isolated credentials, local test data and controlled concurrency; they do not constitute a live PostgreSQL stress test.

## Logs and release

Native verification logs are under `C:/Users/Jayveer/Building Portal/Releases/triple-check-2026-10-22-*.log`. Portal logs are under this checkout's ignored `output/triple-check-2026-10-22-*.log`. The final native result is in `triple-check-2026-10-22-native-final.log`; the reproduction logs intentionally include failures.

Release verification is recorded below against the newly built 4.2.11 installer and source archive. Deploy its manifest and download files together, then update the installed Agent through the normal update flow. The failed historical attempt is not a live paused worker; after updating, start a fresh authorised attempt through the existing recovery flow.

| Release check | Result |
| --- | --- |
| Installer | `public/downloads/ArchitectProAgentSetup-4.2.11.exe`, **46,186,673 bytes**, SHA-256 `f679ecee4e0aa8900f1c51274ab595b91b538c35f2e11f02ece48a27016d7771`. |
| Source archive | `public/downloads/ArchitectProAgentSource-4.2.11.zip`, SHA-256 `2e5d18bd507e7f049d439fef3ad144cae377ecceefcca518765da2303e2705fa`; all **138 entries** match the final native source byte for byte. No runtime preset files included. |
| Embedded application | Compiled PYZ contains version 4.2.11, both `AutomationAgent` connection guards and the new incomplete-lookup/chooser recovery code. |
| Executable startup | Packaged `--smoke-test` exits **0** with an isolated profile, offscreen Qt and a null keyring; it does not poll for jobs or use real credentials. |
| Portal release routes | Installer hash/size, source download, update metadata and uncached redirect test passed against 4.2.11. |
| Portal diagnostics | **479 files: zero errors, zero warnings**, four existing hints. |
| Production build | `npm run build` passed. The installer and source ZIP in `.vercel/output/static/downloads` have the same verified hashes; the built installer size matches the manifest. |

The remaining acceptance check is a complete run on the affected computer and eDevelopment account: sign-in, supporting PDFs, location plan, retained-draft review and the next queued job. No customer application was executed, restarted, submitted or paid for during this review, and the user's installed Agent was not replaced.
